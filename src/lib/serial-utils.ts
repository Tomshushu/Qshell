export type SerialNewlineMode = "auto" | "crlf" | "lf" | "cr" | "raw";

export function normalizeSerialEncoding(value?: string | null): string {
  const label = value?.trim();
  if (!label || ["default", "system", "auto"].includes(label.toLowerCase())) {
    return "utf-8";
  }
  return label;
}

export function decodeBase64Bytes(value?: string): Uint8Array {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function formatSerialHex(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    output += bytes[index].toString(16).toUpperCase().padStart(2, "0");
    output += (index + 1) % 16 === 0 ? "\r\n" : " ";
  }
  return output;
}

export function normalizeSerialNewlines(value: string, mode: SerialNewlineMode): string {
  if (mode === "raw") return value;
  const normalized = value.replace(/\r\n|\r|\n/g, "\n");
  if (mode === "lf") return normalized;
  if (mode === "cr") return normalized.replace(/\n/g, "\r");
  return normalized.replace(/\n/g, "\r\n");
}

export function parseSerialHex(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!/^(?:[0-9a-fA-F]{2})(?:[\s,;:-]+[0-9a-fA-F]{2})*$/.test(trimmed)) {
    throw new Error("Invalid HEX byte sequence");
  }
  return Uint8Array.from(
    trimmed.split(/[\s,;:-]+/).map((part) => Number.parseInt(part, 16)),
  );
}
