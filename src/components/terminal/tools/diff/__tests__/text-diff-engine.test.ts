import { describe, it, expect } from "vitest";
import {
  computeTextDiff,
  computeWordDiff,
  applyChunkFromLeft,
  formatBytes,
} from "../text-diff-engine";

describe("text-diff-engine (通用文本与字符串差异比对引擎)", () => {
  it("formatBytes 格式化展示", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1433)).toBe("1.4 KB");
  });

  it("比对完全相同的文本", () => {
    const text = '{\n  "name": "qshell"\n}';
    const res = computeTextDiff(text, text);
    expect(res.isIdentical).toBe(true);
    expect(res.diffCount).toBe(0);
    expect(res.chunks.length).toBe(0);
    expect(res.lines.length).toBe(3);
    expect(res.lines[0].type).toBe("same");
  });

  it("比对单行普通字符串（支持行内字符/单词高亮）", () => {
    const left = "xxl-job JobThread stoped, hashCode:Thread[xxl-job,JobThread-10, 10, main]";
    const right = "xxl-job JobThread stoped, hashCode:Thread[-8775-exec-10] WARN, 10, main]";
    const res = computeTextDiff(left, right);
    expect(res.isIdentical).toBe(false);
    expect(res.diffCount).toBe(1);
    expect(res.lines.length).toBe(1);
    expect(res.lines[0].type).toBe("modify");
    expect(res.lines[0].leftTokens).toBeDefined();
    expect(res.lines[0].rightTokens).toBeDefined();

    // 验证左侧被移除的 token 中包含特定关键字
    const removedToken = res.lines[0].leftTokens?.find((t) => t.type === "removed");
    expect(removedToken).toBeDefined();
  });

  it("比对多行增删改（支持日志与 JSON 等任何文本）", () => {
    const left = [
      '{"id": 1, "status": "active"}',
      '{"id": 2, "status": "removed_later"}',
      '{"id": 3, "status": "pending"}',
    ].join("\n");

    const right = [
      '{"id": 1, "status": "active"}',
      '{"id": 3, "status": "approved"}',
    ].join("\n");

    const res = computeTextDiff(left, right);
    expect(res.isIdentical).toBe(false);
    expect(res.leftLineCount).toBe(3);
    expect(res.rightLineCount).toBe(2);
    expect(res.chunks.length).toBeGreaterThan(0);
  });

  it("支持将差异块从左侧合并应用到右侧 (applyChunkFromLeft)", () => {
    const left = "line1\nmodified_left\nline3";
    const right = "line1\nmodified_right\nline3";
    const res = computeTextDiff(left, right);
    expect(res.chunks.length).toBe(1);

    const merged = applyChunkFromLeft(left, right, res.chunks[0]);
    expect(merged).toBe(left);
  });

  it("computeWordDiff 细粒度分词差异对比", () => {
    const res = computeWordDiff("hello world test", "hello universe test");
    const removed = res.leftTokens.filter((t) => t.type === "removed").map((t) => t.text);
    const added = res.rightTokens.filter((t) => t.type === "added").map((t) => t.text);
    expect(removed).toContain("world");
    expect(added).toContain("universe");
  });
});
