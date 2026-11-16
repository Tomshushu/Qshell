/**
 * Extracts a clean POSIX or Windows filesystem path from clipboard text.
 * Returns null if the clipboard does not contain a plausible path.
 */
export function extractPathFromClipboardText(
  raw: string | null | undefined,
  mode: "posix" | "windows" | "any" = "any",
): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .split(/\r?\n/)[0]
    ?.trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!trimmed || trimmed.length > 512) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) < 32) return null;
  }

  // Reject URLs cleanly (http://, https://, file:// handled separately if needed)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return null;
  }

  const isPosix =
    trimmed === "~" ||
    trimmed.startsWith("~/") ||
    (trimmed.startsWith("/") && !trimmed.startsWith("//"));
  const isUnc = /^\\\\[^\\/\s]+\\[^\\/\s]+/.test(trimmed);
  const isWinDrive = /^[a-zA-Z]:(?:[\\/][^<>:"|?*]*|[\\/]?)$/.test(trimmed);

  if (mode === "posix") {
    return isPosix ? trimmed : null;
  }
  if (mode === "windows") {
    return isWinDrive || isUnc ? trimmed : null;
  }
  return isPosix || isWinDrive || isUnc ? trimmed : null;
}

/** Reads the system clipboard and extracts a valid target path if present. */
export async function readClipboardPath(
  mode: "posix" | "windows" | "any" = "any",
): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return null;
  }
  try {
    const text = await navigator.clipboard.readText();
    return extractPathFromClipboardText(text, mode);
  } catch {
    return null;
  }
}
