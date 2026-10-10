import { sshService } from "@/services/ssh-service";
import { parseSerialHex } from "@/lib/serial-utils";

export const serialTextWriteQueues = new Map<string, Promise<void>>();

export async function writeSerialTextWithDelaysNow(
  sessionId: string,
  text: string,
  encoding: string,
  lineDelayMs: number,
  charDelayMs: number,
): Promise<void> {
  const segments = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) || [text];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (charDelayMs > 0) {
      const encodedHex = await sshService.encodeSerialText(segment, encoding);
      const bytes = parseSerialHex(encodedHex);
      for (let index = 0; index < bytes.length; index += 1) {
        const result = await sshService.writeSerialRaw(sessionId, [bytes[index]]);
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
