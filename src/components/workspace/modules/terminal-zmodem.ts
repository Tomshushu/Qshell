import type {
  ZmodemModuleLike,
  ZmodemSentryLike,
  ZmodemSessionLike,
} from "@/components/terminal/terminal-types";

export interface ZmodemActiveSessionEntry {
  session: ZmodemSessionLike;
  zmodem: ZmodemModuleLike;
}

interface ZmodemSessionInternals extends ZmodemSessionLike {
  _aborted?: boolean;
  _keepalive_timeout?: ReturnType<typeof setTimeout>;
  _keepalive_promise?: unknown;
  _keep_alive_promise?: unknown;
  _start_keepalive_on_set_sender?: boolean;
}

/**
 * 停止 zmodem.js Send 会话内部每 5 秒发送 ZSINIT 的保活定时器。
 *
 * zmodem.js 1.x 的 `_stop_keepalive()` 存在拼写错误（清理的是 `_keep_alive_promise`
 * 而非 `_keepalive_promise`），且 `openDialog` 取消或 `send_files` 未配对 `close()`
 * 时不会主动清定时器，放任其向已返回 bash 的 PTY 持续注入 `**02000000400c47`。
 */
export function stopZmodemKeepalive(
  session: ZmodemSessionLike | null | undefined,
): void {
  if (!session) return;
  const internal = session as ZmodemSessionInternals;
  if (internal._keepalive_timeout !== undefined && internal._keepalive_timeout !== null) {
    clearTimeout(internal._keepalive_timeout);
    internal._keepalive_timeout = undefined;
  }
  internal._keepalive_promise = null;
  internal._keep_alive_promise = null;
  internal._start_keepalive_on_set_sender = false;
}

/**
 * 在发送完文件后礼貌结束 ZMODEM Send 会话（发送 `ZFIN` 并等待对端确认 `ZFIN` 后回发 `OO`）。
 * 若对端超时无响应或抛出状态异常，回退到 `abort()`，避免远端 `rz` 卡死或保活泄漏。
 */
export async function closeZmodemSendSession(
  session: ZmodemSessionLike | null | undefined,
  timeoutMs = 3000,
): Promise<void> {
  if (!session) return;
  stopZmodemKeepalive(session);
  const internal = session as ZmodemSessionInternals;
  const alreadyAborted =
    typeof session.aborted === "function"
      ? session.aborted()
      : Boolean(internal._aborted);
  if (alreadyAborted) return;

  if (typeof session.close !== "function") {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Promise.resolve(session.close()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("ZMODEM close handshake timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    stopZmodemKeepalive(session);
    const abortedNow =
      typeof session.aborted === "function"
        ? session.aborted()
        : Boolean(internal._aborted);
    if (!abortedNow) {
      try {
        session.abort?.();
      } catch {
        /* ignore already closed/aborted session */
      }
      stopZmodemKeepalive(session);
    }
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function canSendZmodemBytes(
  sessionId: string,
  sentry: ZmodemSentryLike,
  zmodemSentries: Map<string, ZmodemSentryLike>,
  isSessionAlive: (sessionId: string) => boolean,
): boolean {
  return zmodemSentries.get(sessionId) === sentry && isSessionAlive(sessionId);
}

export interface DisposeZmodemSessionOptions {
  sessionId: string;
  zmodemSessions: Map<string, ZmodemActiveSessionEntry>;
  zmodemSentries: Map<string, ZmodemSentryLike>;
  disposingIds?: Set<string>;
  abort?: boolean;
  endBackend?: boolean;
  shellZmodemEnd: (sessionId: string) => Promise<unknown> | unknown;
}

/**
 * 幂等清理单个会话的 ZMODEM 状态：
 * 1. 先移除 `zmodemSessions` 映射并停掉保活定时器；
 * 2. 若需要中止且尚未中止，在移除 sentry 前发出 ZMODEM ABORT_SEQUENCE（5×CAN + 5×BS）；
 * 3. 再移除 `zmodemSentries`，封锁任何后续异步写回；
 * 4. 仅在 `endBackend` 为 true 时通知后端退出 `zmodem_mode`（`onShellZmodemEnd` 回调中严禁传 true，避免 IPC 死循环）。
 */
export function disposeZmodemSession(opts: DisposeZmodemSessionOptions): void {
  const {
    sessionId,
    zmodemSessions,
    zmodemSentries,
    disposingIds,
    abort = false,
    endBackend = false,
    shellZmodemEnd,
  } = opts;

  if (disposingIds?.has(sessionId)) {
    return;
  }

  const entry = zmodemSessions.get(sessionId);
  const hadSentry = zmodemSentries.has(sessionId);
  if (!entry && !hadSentry) {
    return;
  }

  disposingIds?.add(sessionId);
  try {
    zmodemSessions.delete(sessionId);
    const session = entry?.session;
    if (session) {
      stopZmodemKeepalive(session);
      const internal = session as ZmodemSessionInternals;
      const alreadyAborted =
        typeof session.aborted === "function"
          ? session.aborted()
          : Boolean(internal._aborted);
      if (abort && !alreadyAborted) {
        try {
          session.abort?.();
        } catch {
          /* session may already be closed */
        }
        stopZmodemKeepalive(session);
      }
    }
    zmodemSentries.delete(sessionId);
    if (endBackend) {
      void Promise.resolve(shellZmodemEnd(sessionId)).catch(() => {});
    }
  } finally {
    disposingIds?.delete(sessionId);
  }
}

export function disposeAllZmodemSessions(opts: {
  zmodemSessions: Map<string, ZmodemActiveSessionEntry>;
  zmodemSentries: Map<string, ZmodemSentryLike>;
  disposingIds?: Set<string>;
  abort?: boolean;
  endBackend?: boolean;
  shellZmodemEnd: (sessionId: string) => Promise<unknown> | unknown;
}): void {
  const sessionIds = new Set<string>([
    ...opts.zmodemSessions.keys(),
    ...opts.zmodemSentries.keys(),
  ]);
  for (const sessionId of sessionIds) {
    disposeZmodemSession({
      sessionId,
      zmodemSessions: opts.zmodemSessions,
      zmodemSentries: opts.zmodemSentries,
      disposingIds: opts.disposingIds,
      abort: opts.abort,
      endBackend: opts.endBackend,
      shellZmodemEnd: opts.shellZmodemEnd,
    });
  }
}
