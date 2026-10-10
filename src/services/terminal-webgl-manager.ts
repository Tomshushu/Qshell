import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

export interface TerminalWebglOptions {
  termId: string;
  term: Terminal;
  isVisible?: boolean;
  hasBgMedia?: boolean;
  hasFractionalDpr?: boolean;
}

interface TerminalEntry {
  termId: string;
  term: Terminal;
  addon: WebglAddon | null;
  isVisible: boolean;
  hasBgMedia: boolean;
  hasFractionalDpr: boolean;
  lastUsedAt: number;
  lossTimestamps: number[];
  circuitBroken: boolean;
  retryTimer?: ReturnType<typeof setTimeout> | null;
  suspendTimer?: ReturnType<typeof setTimeout> | null;
}

/**
 * 全局 WebGL 渲染器上下文协调器 (Terminal WebGL Manager)
 *
 * 浏览器底层 (Chromium / WebView2) 通常有 8~16 个 WebGL 上下文硬限制。
 * 超出时浏览器会自动驱逐 (Evict) 最旧的上下文并触发 webglcontextlost。
 *
 * 本管理器负责：
 * 1. 最大并发 WebGL 上下文配额控制 (默认 8 个，远低于 16 的物理红线)；
 * 2. 视口感知与 LRU 动态置换：可见终端优先享有 GPU WebGL 加速；
 *    配额不足时优先剥离最久不可见后台标签的 WebGL 上下文（平滑降级为 DOM 渲染器，不丢 Buffer/输出）；
 * 3. 熔断保护 (Circuit Breaker)：单终端遭遇 context loss 限制重试次数与间隔，
 *    频繁丢失时永久平滑降级到 DOM 渲染器，彻底杜绝 Ping-Pong 相互驱逐死循环；
 * 4. 完美兼容背景媒体透明度与非整数 DPR 规则。
 */
export class TerminalWebglManager {
  private terminals = new Map<string, TerminalEntry>();
  private readonly maxActiveContexts: number;
  private readonly contextLossThreshold: number;
  private readonly contextLossWindowMs: number;
  private readonly contextLossRetryDelayMs: number;

  constructor(options?: {
    maxActiveContexts?: number;
    contextLossThreshold?: number;
    contextLossWindowMs?: number;
    contextLossRetryDelayMs?: number;
  }) {
    this.maxActiveContexts = options?.maxActiveContexts ?? 8;
    this.contextLossThreshold = options?.contextLossThreshold ?? 2;
    this.contextLossWindowMs = options?.contextLossWindowMs ?? 60_000;
    this.contextLossRetryDelayMs = options?.contextLossRetryDelayMs ?? 1_000;
  }

  /**
   * 注册终端实例并尝试分配 WebGL 渲染器
   */
  public registerTerminal(opts: TerminalWebglOptions): boolean {
    const existing = this.terminals.get(opts.termId);
    if (existing) {
      if (existing.term !== opts.term) {
        this.unregisterTerminal(opts.termId);
      } else {
        this.updateState(opts.termId, {
          isVisible: opts.isVisible,
          hasBgMedia: opts.hasBgMedia,
          hasFractionalDpr: opts.hasFractionalDpr,
        });
        return existing.addon !== null;
      }
    }

    const entry: TerminalEntry = {
      termId: opts.termId,
      term: opts.term,
      addon: null,
      isVisible: opts.isVisible ?? true,
      hasBgMedia: opts.hasBgMedia ?? false,
      hasFractionalDpr: opts.hasFractionalDpr ?? false,
      lastUsedAt: Date.now(),
      lossTimestamps: [],
      circuitBroken: false,
    };

    this.terminals.set(opts.termId, entry);

    if (entry.isVisible) {
      return this.requestWebgl(opts.termId);
    }
    return false;
  }

  /**
   * 更新终端状态（可见性、背景图、缩放等）
   */
  public updateState(
    termId: string,
    updates: Partial<{
      isVisible: boolean;
      hasBgMedia: boolean;
      hasFractionalDpr: boolean;
    }>,
  ): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;

    if (updates.isVisible !== undefined) entry.isVisible = updates.isVisible;
    if (updates.hasBgMedia !== undefined) entry.hasBgMedia = updates.hasBgMedia;
    if (updates.hasFractionalDpr !== undefined)
      entry.hasFractionalDpr = updates.hasFractionalDpr;

    if (entry.hasBgMedia) {
      if (entry.suspendTimer) {
        clearTimeout(entry.suspendTimer);
        entry.suspendTimer = null;
      }
      if (entry.addon) {
        this.detachWebgl(entry);
      }
      return;
    }

    if (entry.isVisible) {
      if (entry.suspendTimer) {
        clearTimeout(entry.suspendTimer);
        entry.suspendTimer = null;
      }
      entry.lastUsedAt = Date.now();
      if (!entry.addon && !entry.circuitBroken) {
        this.requestWebgl(termId);
      }
    } else {
      // 当终端处于后台隐藏状态时，设置防抖挂起定时器（3秒）：
      // 避免短暂切换标签时反复创建销毁 WebGL 上下文；
      // 若持续处于后台，则剥离 WebGL 渲染器，暂停 GPU 实时渲染与字形纹理贴图膨胀，
      // 防止长时间海量日志导致 GPU 上下文与显存碎片化。
      if (!entry.suspendTimer && entry.addon) {
        entry.suspendTimer = setTimeout(() => {
          entry.suspendTimer = null;
          const curr = this.terminals.get(termId);
          if (curr && !curr.isVisible && curr.addon) {
            this.detachWebgl(curr);
          }
        }, 3000);
      }
    }
  }

  /**
   * 为指定终端申请并装载 WebGL 渲染器
   */
  public requestWebgl(termId: string): boolean {
    const entry = this.terminals.get(termId);
    if (!entry) return false;

    // 1. 若处于熔断保护，直接走 DOM 渲染，绝不循环重试
    if (entry.circuitBroken) {
      return false;
    }

    // 2. 自定义背景媒体：按策略使用 DOM（避免 WebGL canvas 遮挡底层半透明背景媒体）
    // 注意：现代 @xterm/addon-webgl (>=0.19) 已完美支持非整数 DPR (125%/150%)，
    // 全力开启 GPU 硬件加速，彻底消灭 DOM 渲染带来的巨幅性能开销。
    if (entry.hasBgMedia) {
      if (entry.addon) {
        this.detachWebgl(entry);
      }
      return false;
    }

    // 3. 已经装载 WebGL
    if (entry.addon) {
      entry.lastUsedAt = Date.now();
      return true;
    }

    // 4. 若活跃配额已满，置换最久不可见/最早活动的实例
    if (this.getActiveCount() >= this.maxActiveContexts) {
      const evicted = this.evictOneCandidate(termId);
      if (!evicted) {
        return false;
      }
    }

    // 5. 创建并挂载 WebglAddon
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        this.handleContextLoss(termId);
      });
      entry.term.loadAddon(addon);
      entry.addon = addon;
      entry.lastUsedAt = Date.now();

      const core = (entry.term as any)._core;
      if (core?._viewport) {
        core._viewport._latestYDisp = undefined;
        try {
          core._viewport._sync?.();
        } catch {
          // ignore
        }
      }

      try {
        if (entry.term.rows > 0) {
          entry.term.refresh(0, entry.term.rows - 1);
        }
      } catch {
        // 刷新异常可忽略
      }
      return true;
    } catch (err) {
      console.warn(
        `[Terminal WebGL] WebGL renderer unavailable for ${termId}, falling back to DOM:`,
        err,
      );
      return false;
    }
  }

  /**
   * 卸载注销终端
   */
  public unregisterTerminal(termId: string): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;

    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }

    if (entry.suspendTimer) {
      clearTimeout(entry.suspendTimer);
      entry.suspendTimer = null;
    }

    if (entry.addon) {
      this.detachWebgl(entry);
    }

    this.terminals.delete(termId);
  }

  /**
   * 清除所有活跃 WebGL 渲染器的字形纹理缓存（切换主题时调用）
   */
  public clearAllTextureAtlases(): void {
    for (const entry of this.terminals.values()) {
      if (entry.addon) {
        try {
          entry.addon.clearTextureAtlas();
        } catch {
          // 忽略已销毁或不支持的异常
        }
      }
    }
  }

  /**
   * 触发 context loss 时的智能熔断处理
   */
  public handleContextLoss(termId: string): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;

    // 立即释放失效的 addon
    if (entry.addon) {
      try {
        entry.addon.dispose();
      } catch {
        // 忽略异常
      }
      entry.addon = null;
    }

    const now = Date.now();
    entry.lossTimestamps = entry.lossTimestamps
      .filter((ts) => now - ts < this.contextLossWindowMs)
      .concat(now);

    // 尝试用 DOM 渲染器重绘当前 buffer，避免画面全黑
    const core = (entry.term as any)._core;
    if (core?._viewport) {
      core._viewport._latestYDisp = undefined;
      try {
        core._viewport._sync?.();
      } catch {
        // ignore
      }
    }
    try {
      if (entry.term.rows > 0) {
        entry.term.refresh(0, entry.term.rows - 1);
      }
    } catch {
      // 忽略刷新异常
    }

    // 检查是否达到熔断阈值（频繁 context loss）
    if (entry.lossTimestamps.length >= this.contextLossThreshold) {
      entry.circuitBroken = true;
      console.warn(
        `[Terminal WebGL] Context lost repeatedly (${entry.lossTimestamps.length} times) for terminal ${termId}. ` +
          `Tripping circuit breaker and falling back to DOM renderer permanently to prevent GPU thrashing.`,
      );
      return;
    }

    // 未熔断：延迟防抖重试 1 次（仅在该终端当前仍处于前台可见时）
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
    }
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      const current = this.terminals.get(termId);
      if (!current || current.circuitBroken) return;
      if (current.isVisible) {
        this.requestWebgl(termId);
      }
    }, this.contextLossRetryDelayMs);
  }

  /**
   * 获取当前活跃的 WebGL 上下文数量
   */
  public getActiveCount(): number {
    let count = 0;
    for (const entry of this.terminals.values()) {
      if (entry.addon !== null) count++;
    }
    return count;
  }

  /**
   * 检查指定终端是否正运行 WebGL 渲染
   */
  public isWebglActive(termId: string): boolean {
    return Boolean(this.terminals.get(termId)?.addon);
  }

  /**
   * 检查指定终端是否已熔断
   */
  public isCircuitBroken(termId: string): boolean {
    return this.terminals.get(termId)?.circuitBroken === true;
  }

  /**
   * 释放并降级单个终端的 WebGL 渲染器为 DOM 渲染
   */
  private detachWebgl(entry: TerminalEntry): void {
    if (!entry.addon) return;
    try {
      entry.addon.dispose();
    } catch {
      // 忽略销毁异常
    }
    entry.addon = null;
    try {
      if (entry.term.rows > 0) {
        entry.term.refresh(0, entry.term.rows - 1);
      }
    } catch {
      // 忽略刷新异常
    }
  }

  /**
   * 淘汰置换一个 WebGL 槽位（优先置换不可见的后台终端，其次置换最久活动的终端）
   */
  private evictOneCandidate(requestingTermId: string): boolean {
    const activeEntries: TerminalEntry[] = [];
    for (const entry of this.terminals.values()) {
      if (entry.addon !== null && entry.termId !== requestingTermId) {
        activeEntries.push(entry);
      }
    }
    if (activeEntries.length === 0) return false;

    // 1. 优先在后台（不可见）的终端中淘汰最久未活跃的
    const hiddenCandidates = activeEntries.filter((e) => !e.isVisible);
    if (hiddenCandidates.length > 0) {
      hiddenCandidates.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      this.detachWebgl(hiddenCandidates[0]);
      return true;
    }

    // 2. 如果所有活跃终端都在前台（极罕见的大量分屏场景），淘汰最久未获得焦点的
    activeEntries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    this.detachWebgl(activeEntries[0]);
    return true;
  }
}

export const terminalWebglManager = new TerminalWebglManager();
