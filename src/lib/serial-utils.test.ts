import { describe, expect, it } from "vitest";
import {
  decodeBase64Bytes,
  formatSerialHex,
  normalizeSerialNewlines,
  normalizeSerialEncoding,
  parseSerialHex,
} from "./serial-utils";

describe("serial utilities", () => {
  it("normalizes every supported newline mode", () => {
    const input = "a\rb\nc\r\nd";
    expect(normalizeSerialNewlines(input, "crlf")).toBe("a\r\nb\r\nc\r\nd");
    expect(normalizeSerialNewlines(input, "auto")).toBe("a\r\nb\r\nc\r\nd");
    expect(normalizeSerialNewlines(input, "lf")).toBe("a\nb\nc\nd");
    expect(normalizeSerialNewlines(input, "cr")).toBe("a\rb\rc\rd");
    expect(normalizeSerialNewlines(input, "raw")).toBe(input);
  });

  it("maps generic terminal defaults to a real serial encoding", () => {
    expect(normalizeSerialEncoding("default")).toBe("utf-8");
    expect(normalizeSerialEncoding("SYSTEM")).toBe("utf-8");
    expect(normalizeSerialEncoding("")).toBe("utf-8");
    expect(normalizeSerialEncoding("gbk")).toBe("gbk");
  });

  it("formats actual raw bytes rather than re-encoded text", () => {
    expect(formatSerialHex(Uint8Array.from([0, 15, 16, 255]))).toBe("00 0F 10 FF ");
    expect(Array.from(decodeBase64Bytes("AP8Q"))).toEqual([0, 255, 16]);
  });

  it("accepts complete HEX bytes and rejects ambiguous input", () => {
    expect(Array.from(parseSerialHex("AA 55:01-02"))).toEqual([170, 85, 1, 2]);
    expect(() => parseSerialHex("A 55")).toThrow();
    expect(() => parseSerialHex("GG")).toThrow();
  });
});
