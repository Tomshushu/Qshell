/**
 * 终端输出流旁路观察者总线（Wave 0 U4 底座）。
 *
 * 目标：将触发器、脚本录制、流量统计、规则高亮等外围能力从 9789 行的 `terminal.tsx`
 * `writeShellOutput` 热路径剥离出来，变成按优先级注册、异常隔离、自带洪峰节流的插件管线。
 *
 * 注意：此总线仅面向只读旁路消费；底层背压分帧、SIGINT 排空与 `term.write` 主路径保持独立。
 */

export interface OutputChunkEvent {
  termId: string;
  sessionId?: string;
  /** 服务端/串口原始输出块（未加时间戳与终端改写前） */
  rawChunk: string;
  /** 经过时间戳等视觉预处理后的展示字符串 */
  renderedChunk: string;
  timestampMs: number;
}

export interface OutputObserver {
  /** 唯一标识；同 ID 重复注册会自动覆盖旧项 */
  id: string;
  /** 执行优先级（数值越小越先执行，默认 100） */
  priority?: number;
  /** 是否绕过洪峰限流（如精确交互式密码提示匹配可置 true，常规观察者建议 false） */
  bypassThrottle?: boolean;
  /** 触发洪峰阈值时的最小派发间隔（毫秒，默认 100ms） */
  throttleMs?: number;
  onChunk: (event: OutputChunkEvent) => void;
}

interface TrafficWindow {
  windowStartMs: number;
  charsInWindow: number;
  lastDispatchByObserver: Map<string, number>;
}

/** 洪峰降频阈值：单终端 1 秒滑动窗内超过 2M 字符即进入温和降频，保护 UI 与主线程响应 */
export const OUTPUT_BUS_FLOOD_THRESHOLD_CHARS = 2 * 1024 * 1024;
const TRAFFIC_WINDOW_MS = 1000;
const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_PRIORITY = 100;

class TerminalOutputBus {
  private observers = new Map<string, OutputObserver>();
  private sortedCache: OutputObserver[] = [];
  private trafficByTerm = new Map<string, TrafficWindow>();

  register(observer: OutputObserver): () => void {
    this.observers.set(observer.id, observer);
    this.rebuildSortedCache();
    return () => {
      if (this.observers.get(observer.id) === observer) {
        this.observers.delete(observer.id);
        this.rebuildSortedCache();
      }
    };
  }

  unregister(id: string): void {
    if (this.observers.delete(id)) {
      this.rebuildSortedCache();
    }
  }

  dispatch(event: OutputChunkEvent): void {
    if (this.sortedCache.length === 0) return;

    const now = event.timestampMs;
    let windowState = this.trafficByTerm.get(event.termId);
    if (!windowState || now - windowState.windowStartMs >= TRAFFIC_WINDOW_MS) {
      windowState = {
        windowStartMs: now,
        charsInWindow: 0,
        lastDispatchByObserver: windowState?.lastDispatchByObserver ?? new Map(),
      };
      this.trafficByTerm.set(event.termId, windowState);
    }

    windowState.charsInWindow += event.rawChunk.length;
    const isFlooding = windowState.charsInWindow > OUTPUT_BUS_FLOOD_THRESHOLD_CHARS;

    for (const observer of this.sortedCache) {
      if (isFlooding && !observer.bypassThrottle) {
        const throttleMs = observer.throttleMs ?? DEFAULT_THROTTLE_MS;
        const lastAt = windowState.lastDispatchByObserver.get(observer.id) ?? 0;
        if (throttleMs > 0 && now - lastAt < throttleMs) {
          continue;
        }
      }
      windowState.lastDispatchByObserver.set(observer.id, now);
      try {
        observer.onChunk(event);
      } catch (err) {
        console.error(`[TerminalOutputBus] Observer "${observer.id}" threw error:`, err);
      }
    }
  }

  clearSession(termId: string): void {
    this.trafficByTerm.delete(termId);
  }

  /** 清空所有终端的流量窗口状态（终端模块整体卸载时调用，防止全局总线残留） */
  clearAllSessions(): void {
    this.trafficByTerm.clear();
  }

  /** 仅用于测试清理 */
  resetAll(): void {
    this.observers.clear();
    this.sortedCache = [];
    this.trafficByTerm.clear();
  }

  getRegisteredIds(): string[] {
    return this.sortedCache.map((obs) => obs.id);
  }

  private rebuildSortedCache(): void {
    this.sortedCache = Array.from(this.observers.values()).sort(
      (a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY),
    );
  }
}

export const terminalOutputBus = new TerminalOutputBus();

export function registerOutputObserver(observer: OutputObserver): () => void {
  return terminalOutputBus.register(observer);
}

export function dispatchTerminalOutputObservers(
  termId: string,
  rawChunk: string,
  renderedChunk: string,
  sessionId?: string,
  timestampMs = Date.now(),
): void {
  terminalOutputBus.dispatch({
    termId,
    sessionId,
    rawChunk,
    renderedChunk,
    timestampMs,
  });
}

export function clearOutputBusSession(termId: string): void {
  terminalOutputBus.clearSession(termId);
}

export function clearAllOutputBusSessions(): void {
  terminalOutputBus.clearAllSessions();
}
