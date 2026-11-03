import { describe, it, expect } from "vitest";
import { ALL_FORMATTERS, detectFormatters } from "../text-formatters";
import { extractJson, extractAllJson } from "../json-utils";

describe("text-formatters and json-utils comprehensive suite", () => {
  describe("JSON extraction (json-utils)", () => {
    it("extracts structured JSON objects and arrays", () => {
      const obj = extractJson('{"name": "Alice", "age": 30}');
      expect(obj).not.toBeNull();
      expect(obj?.parsed).toEqual({ name: "Alice", age: 30 });

      const arr = extractJson('[1, "two", {"three": 3}]');
      expect(arr).not.toBeNull();
      expect(arr?.parsed).toEqual([1, "two", { three: 3 }]);
    });

    it("extracts embedded JSON from raw log lines", () => {
      const log = "2026-10-31 19:30:00 [INFO] app.server: {\"traceId\": \"abc-123\", \"code\": 200} dispatched";
      const res = extractJson(log);
      expect(res).not.toBeNull();
      expect(res?.parsed).toEqual({ traceId: "abc-123", code: 200 });
    });

    it("extracts multiple JSON objects across lines via extractAllJson", () => {
      const text = "first: {\"id\": 1} and second: {\"id\": 2}";
      const all = extractAllJson(text);
      expect(all.length).toBe(2);
      expect(all[0].parsed).toEqual({ id: 1 });
      expect(all[1].parsed).toEqual({ id: 2 });
    });

    it("refuses primitive literals (numbers, booleans, null, strings) so they do not shadow other formatters", () => {
      expect(extractJson("1730372400")).toBeNull();
      expect(extractJson("12345")).toBeNull();
      expect(extractJson("true")).toBeNull();
      expect(extractJson("false")).toBeNull();
      expect(extractJson("null")).toBeNull();
      expect(extractJson('"just a string"')).toBeNull();

      expect(extractAllJson("1730372400")).toEqual([]);
      expect(extractAllJson("true")).toEqual([]);
    });
  });

  describe("Timestamp formatter", () => {
    it("detects and formats 10-digit second timestamps", () => {
      const s = "1730372400";
      const fmts = detectFormatters(s);
      expect(fmts[0]?.id).toBe("timestamp");
      const out = fmts[0]?.format(s);
      expect(out).toContain("本地时间");
      expect(out).toContain("UTC: 2024-10-31");
      expect(out).toContain("（秒）");
    });

    it("detects and formats 13-digit millisecond timestamps", () => {
      const ms = "1730372400000";
      const fmts = detectFormatters(ms);
      expect(fmts[0]?.id).toBe("timestamp");
      const out = fmts[0]?.format(ms);
      expect(out).toContain("UTC: 2024-10-31");
      expect(out).toContain("（毫秒）");
    });

    it("detects and formats 16-digit microsecond timestamps", () => {
      const us = "1730372400000000";
      const fmts = detectFormatters(us);
      expect(fmts[0]?.id).toBe("timestamp");
      const out = fmts[0]?.format(us);
      expect(out).toContain("UTC: 2024-10-31");
      expect(out).toContain("（微秒）");
    });

    it("detects and formats 19-digit nanosecond timestamps", () => {
      const ns = "1730372400000000000";
      const fmts = detectFormatters(ns);
      expect(fmts[0]?.id).toBe("timestamp");
      const out = fmts[0]?.format(ns);
      expect(out).toContain("UTC: 2024-10-31");
      expect(out).toContain("（纳秒）");
    });

    it("extracts multiple timestamps from a JSON structure when timestamp format is applied", () => {
      const json = JSON.stringify(
        {
          orderId: "1001",
          createdAt: 1730372400,
          expireAt: 1730376000000,
        },
        null,
        2,
      );
      const timestampFmt = ALL_FORMATTERS.find((f) => f.id === "timestamp");
      expect(timestampFmt).toBeDefined();
      const out = timestampFmt!.format(json);
      expect(out).not.toBeNull();
      expect(out).toContain("共提取到 2 处时间戳");
      expect(out).toContain("createdAt");
      expect(out).toContain("1730372400");
      expect(out).toContain("expireAt");
      expect(out).toContain("1730376000000");
      expect(out).toContain("本地时间");
      expect(out).toContain("UTC");
    });
  });

  describe("Unix Permission formatter (bidirectional)", () => {
    it("converts octal 755 to rwxr-xr-x and provides chmod recommendation", () => {
      const fmts = detectFormatters("755");
      const permFmt = fmts.find((f) => f.id === "unix-permission");
      expect(permFmt).toBeDefined();
      const out = permFmt!.format("755");
      expect(out).toContain("rwxr-xr-x");
      expect(out).toContain("chmod 755");
      expect(out).toContain("拥有者 (User): rwx (7)");
    });

    it("converts octal with setuid (4755)", () => {
      const fmts = detectFormatters("4755");
      const permFmt = fmts.find((f) => f.id === "unix-permission");
      expect(permFmt).toBeDefined();
      const out = permFmt!.format("4755");
      expect(out).toContain("rwsr-xr-x");
      expect(out).toContain("setuid");
    });

    it("converts symbolic permissions (-rwxr-xr-x) to octal 0755 and detects file type", () => {
      const fmts = detectFormatters("-rwxr-xr-x");
      const permFmt = fmts.find((f) => f.id === "unix-permission");
      expect(permFmt).toBeDefined();
      const out = permFmt!.format("-rwxr-xr-x");
      expect(out).toContain("八进制: 0755");
      expect(out).toContain("普通文件 (-)");
      expect(out).toContain("chmod 755");
    });

    it("converts directory symbolic permissions (drwxrwxrwx) to 0777", () => {
      const fmts = detectFormatters("drwxrwxrwx");
      const permFmt = fmts.find((f) => f.id === "unix-permission");
      expect(permFmt).toBeDefined();
      const out = permFmt!.format("drwxrwxrwx");
      expect(out).toContain("八进制: 0777");
      expect(out).toContain("目录文件 (d)");
    });

    it("converts symbolic permission with sticky bit (drwxrwxrwt) to 1777", () => {
      const fmts = detectFormatters("drwxrwxrwt");
      const permFmt = fmts.find((f) => f.id === "unix-permission");
      expect(permFmt).toBeDefined();
      const out = permFmt!.format("drwxrwxrwt");
      expect(out).toContain("1777");
      expect(out).toContain("sticky");
    });
  });

  describe("URL Query and Env Vars formatters", () => {
    it("formats full URLs cleanly without including path in query parameter keys", () => {
      const url = "https://api.github.com/repos?page=1&per_page=100&q=%E6%B5%8B%E8%AF%95";
      const fmts = detectFormatters(url);
      const urlFmt = fmts.find((f) => f.id === "url-query");
      expect(urlFmt).toBeDefined();
      const out = urlFmt!.format(url);
      expect(out).not.toBeNull();
      expect(out).toContain("page     = 1");
      expect(out).toContain("per_page = 100");
      expect(out).toContain("q        = 测试");
      expect(out).not.toContain("https://api.github.com/repos?page");
      expect(out).toContain("URL 基础路径: https://api.github.com/repos");
    });

    it("formats standalone query strings (a=1&b=2)", () => {
      const query = "foo=123&bar=456";
      const fmts = detectFormatters(query);
      const urlFmt = fmts.find((f) => f.id === "url-query");
      expect(urlFmt).toBeDefined();
      const out = urlFmt!.format(query);
      expect(out).toContain("foo = 123");
      expect(out).toContain("bar = 456");
    });

    it("rejects multi-line strings in url-query and delegates to env-vars", () => {
      const envText = "PORT=8080\nNODE_ENV=production\nDEBUG=true";
      const fmts = detectFormatters(envText);
      expect(fmts.some((f) => f.id === "url-query")).toBe(false);
      expect(fmts[0]?.id).toBe("env-vars");
      const out = fmts[0]?.format(envText);
      expect(out).toContain("PORT     = 8080");
      expect(out).toContain("NODE_ENV = production");
    });
  });

  describe("Number base formatter", () => {
    it("handles hex, binary, and octal with BigInt without 64-bit precision loss", () => {
      const hex = "0x1A";
      const fmts = detectFormatters(hex);
      expect(fmts.some((f) => f.id === "number-base")).toBe(true);
      const out = fmts.find((f) => f.id === "number-base")!.format(hex);
      expect(out).toContain("十进制: 26");
      expect(out).toContain("十六进制: 0x1A");
      expect(out).toContain("二进制: 0b11010");

      const bigHex = "0xffffffffffffffff";
      const bigOut = fmts.find((f) => f.id === "number-base")!.format(bigHex);
      expect(bigOut).toContain("十进制: 18446744073709551615");
    });
  });

  describe("XML formatter", () => {
    it("detects standard, nested, and self-closing XML tags", () => {
      expect(detectFormatters("<root><child a='1'>val</child></root>").some((f) => f.id === "xml")).toBe(true);
      expect(detectFormatters("<request id='100' action='sync' />").some((f) => f.id === "xml")).toBe(true);
      expect(detectFormatters("<?xml version='1.0'?><data></data>").some((f) => f.id === "xml")).toBe(true);
    });

    it("indents XML hierarchically", () => {
      const xml = "<root><item>A</item><item>B</item></root>";
      const fmt = detectFormatters(xml).find((f) => f.id === "xml");
      const out = fmt!.format(xml);
      expect(out).toContain("  <item>A</item>");
      expect(out).toContain("  <item>B</item>");
    });
  });

  describe("Base64 and Hex UTF-8 validation", () => {
    it("detects and decodes valid UTF-8 base64 text", () => {
      const b64 = "SGVsbG8gV29ybGQ="; // "Hello World"
      const fmts = detectFormatters(b64);
      const b64Fmt = fmts.find((f) => f.id === "base64");
      expect(b64Fmt).toBeDefined();
      expect(b64Fmt!.format(b64)).toBe("Hello World");
    });

    it("rejects binary hashes or invalid UTF-8 in hex and base64", () => {
      const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const fmts = detectFormatters(sha256);
      expect(fmts.some((f) => f.id === "hex")).toBe(false);
    });
  });

  describe("JWT formatter", () => {
    it("decodes 3-part JWT header and payload", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const fmts = detectFormatters(jwt);
      const jwtFmt = fmts.find((f) => f.id === "jwt");
      expect(jwtFmt).toBeDefined();
      const out = jwtFmt!.format(jwt);
      expect(out).toContain("Header:");
      expect(out).toContain('"alg": "HS256"');
      expect(out).toContain("Payload:");
      expect(out).toContain('"sub": "1234567890"');
      expect(out).toContain("Signature (未解码):");
    });
  });
});
