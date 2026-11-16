import { describe, it, expect } from "vitest";
import { extractPathFromClipboardText } from "../clipboard-path";

describe("extractPathFromClipboardText", () => {
  it("extracts quoted POSIX paths and strips whitespace", () => {
    expect(extractPathFromClipboardText('  "/var/log/nginx/error.log" \nsecond line', "posix")).toBe(
      "/var/log/nginx/error.log",
    );
    expect(extractPathFromClipboardText("~/projects/qshell", "posix")).toBe("~/projects/qshell");
  });

  it("extracts Windows drive and UNC paths", () => {
    expect(extractPathFromClipboardText("'D:\\SSHTOOL\\Qshell'", "windows")).toBe(
      "D:\\SSHTOOL\\Qshell",
    );
    expect(extractPathFromClipboardText("\\\\server\\share\\folder", "windows")).toBe(
      "\\\\server\\share\\folder",
    );
    expect(extractPathFromClipboardText("D:/work/app", "any")).toBe("D:/work/app");
  });

  it("rejects URLs, plain prose, and mismatched mode paths", () => {
    expect(extractPathFromClipboardText("https://example.com/a/b", "any")).toBeNull();
    expect(extractPathFromClipboardText("hello world", "any")).toBeNull();
    expect(extractPathFromClipboardText("C:\\Windows", "posix")).toBeNull();
    expect(extractPathFromClipboardText("/etc/hosts", "windows")).toBeNull();
  });
});
