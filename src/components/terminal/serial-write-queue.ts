import { sshService } from "@/services/ssh-service";
import { parseSerialHex } from "@/lib/serial-utils";

export const serialTextWriteQueues = new Map<string, Promise<void>>();
// 会话关闭/断线后标记取消：in-flight 的逐字节延迟发送循环据此提前退出，
// 避免一次挂起/长队列阻塞该串口后续所有输入
const serialWriteCancelFlags = new Set<string>();

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function writeSerialTextWithDelaysNow(
  sessionId: string,
  text: string,
  encoding: string,
  lineDelayMs: number,
  charDelayMs: number,
): Promise<void> {
  serialWriteCancelFlags.delete(sessionId);
  const segments = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) || [text];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    if (serialWriteCancelFlags.has(sessionId)) return;
    const segment = segments[segmentIndex];
    if (charDelayMs > 0) {
      const encodedHex = await withTimeout(
        sshService.encodeSerialText(segment, encoding),
        10_000,
        "串口编码超时",
      );
      const bytes = parseSerialHex(encodedHex);
      for (let index = 0; index < bytes.length; index += 1) {
        if (serialWriteCancelFlags.has(sessionId)) return;
        const result = await withTimeout(
          sshService.writeSerialRaw(sessionId, [bytes[index]]),
          5_000,
          "串口写入超时",
        );
        if (!result.success) throw new Error(result.error || "串口逐字节发送失败");
        if (index < bytes.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, charDelayMs));
        }
      }
    } else {
      await sshService.writeToShell(sessionId, segment);
    }
    if (lineDelayMs > 0 && segmentIndex < segments.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, lineDelayMs));
    }
  }
}

/**
 * Keep text writes ordered per serial session. xterm may emit a new onData event
 * while the previous delayed write is still running; without a queue, bytes from
 * two keystrokes/pastes can interleave when character or line delay is enabled.
 */
export function writeSerialTextWithDelays(
  sessionId: string,
  text: string,
  encoding: string,
  lineDelayMs: number,
  charDelayMs: number,
): Promise<void> {
  const previous = serialTextWriteQueues.get(sessionId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => writeSerialTextWithDelaysNow(
      sessionId,
      text,
      encoding,
      lineDelayMs,
      charDelayMs,
    ));
  serialTextWriteQueues.set(sessionId, current);
  void current.finally(() => {
    if (serialTextWriteQueues.get(sessionId) === current) {
      serialTextWriteQueues.delete(sessionId);
    }
  }).catch(() => undefined);
  return current;
}

/**
 * 串口会话关闭/断线时调用：取消 in-flight 的延迟发送并清空待发队列，
 * 防止某次 writeSerialRaw 挂起导致该会话后续输入被永久阻塞。
 */
export function clearSerialWriteQueue(sessionId: string): void {
  serialWriteCancelFlags.add(sessionId);
  serialTextWriteQueues.delete(sessionId);
}
