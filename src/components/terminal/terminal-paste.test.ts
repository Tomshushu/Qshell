import { describe, it, expect } from "vitest";
import { normalizeShellCommandText, formatTerminalPasteData } from "./terminal-utils";

describe("normalizeShellCommandText", () => {
  it("handles empty or falsy text", () => {
    expect(normalizeShellCommandText("")).toBe("");
  });

  it("normalizes Windows CRLF to single LF", () => {
    const input = "echo line1\r\necho line2\r\n";
    expect(normalizeShellCommandText(input)).toBe("echo line1\necho line2\n");
  });

  it("normalizes single isolated CR to LF", () => {
    const input = "echo line1\recho line2\r";
    expect(normalizeShellCommandText(input)).toBe("echo line1\necho line2\n");
  });

  it("fixes backslash line continuation with CRLF", () => {
    const input =
      'curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \\\r\n' +
      "  -o /usr/local/lib/docker/cli-plugins/docker-compose";
    const expected =
      'curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \\\n' +
      "  -o /usr/local/lib/docker/cli-plugins/docker-compose";
    expect(normalizeShellCommandText(input)).toBe(expected);
  });

  it("fixes backslash followed by trailing spaces or tabs before newline", () => {
    // 带空格的续行
    const inputWithSpace = "command --arg1 \\  \r\n  --arg2\r\n";
    expect(normalizeShellCommandText(inputWithSpace)).toBe("command --arg1 \\\n  --arg2\n");

    // 带制表符的续行
    const inputWithTab = "command --arg1 \\\t\r\n  --arg2\r\n";
    expect(normalizeShellCommandText(inputWithTab)).toBe("command --arg1 \\\n  --arg2\n");

    // 带 LF 和空格的续行
    const inputWithLfAndSpaces = "command --arg1 \\   \n  --arg2\n";
    expect(normalizeShellCommandText(inputWithLfAndSpaces)).toBe("command --arg1 \\\n  --arg2\n");

    // 带 Unicode 不间断空格 (\u00A0) 的续行
    const inputWithNbsp = "command --arg1 \\\u00A0\r\n  --arg2\r\n";
    expect(normalizeShellCommandText(inputWithNbsp)).toBe("command --arg1 \\\n  --arg2\n");
  });

  it("preserves single-line command unchanged", () => {
    const single = "ls -la /var/log";
    expect(normalizeShellCommandText(single)).toBe(single);
  });
});

describe("formatTerminalPasteData", () => {
  it("formats unbracketed paste without execution", () => {
    const input = "echo line1 \\\r\n  line2";
    expect(formatTerminalPasteData(input, { bracketedPaste: false, execute: false })).toBe(
      "echo line1 \\\n  line2"
    );
  });

  it("formats unbracketed paste with execution", () => {
    const input = "echo line1 \\\r\n  line2";
    expect(formatTerminalPasteData(input, { bracketedPaste: false, execute: true })).toBe(
      "echo line1 \\\n  line2\r"
    );

    // 已带末尾换行的规范化为回车提交
    const inputWithNl = "echo line1 \\\r\n  line2\r\n";
    expect(formatTerminalPasteData(inputWithNl, { bracketedPaste: false, execute: true })).toBe(
      "echo line1 \\\n  line2\r"
    );
  });

  it("wraps in bracketed paste mode without execution, stripping trailing newline to keep cursor at line end", () => {
    const input = "echo line1 \\\r\n  line2\r\n";
    const result = formatTerminalPasteData(input, { bracketedPaste: true, execute: false });
    expect(result).toBe("\x1b[200~echo line1 \\\n  line2\x1b[201~");
  });

  it("wraps in bracketed paste mode with execution, appending carriage return outside bracket", () => {
    const input = "echo line1 \\\r\n  line2";
    const result = formatTerminalPasteData(input, { bracketedPaste: true, execute: true });
    expect(result).toBe("\x1b[200~echo line1 \\\n  line2\x1b[201~\r");
  });
});
