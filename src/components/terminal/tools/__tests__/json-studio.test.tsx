/**
 * 工作台「工具 → JSON 格式化」回归测试：
 * 1. JSON 解析 / 转义解包逻辑
 * 2. 并排对比视图默认保留编辑区的换行排版（不把原文挤成一整行）
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { JsonStudioTool, tryParseJson } from "../JsonStudioTool";
import { useTextFormatterStore } from "@/store/text-formatter-store";
import { SideBySideDiffViewer } from "../diff/SideBySideDiffViewer";

const WRAP_KEY = "qshell_json_diff_wrap_lines";

describe("tryParseJson (JSON 解析与转义解包)", () => {
  it("标准 JSON 原样解析，字符串值内的合法转义不被破坏", () => {
    const res = tryParseJson('{"msg":"say \\"hi\\"","path":"C:\\\\data"}');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ msg: 'say "hi"', path: "C:\\data" });
  });

  it("外层引号包裹的 JSON 字符串解析成对象，而不是停留在字符串", () => {
    const res = tryParseJson('"{\\"a\\":1}"');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ a: 1 });
  });

  it("日志里整段被转义的 JSON 可解包，字符串值内的引号正确还原", () => {
    const res = tryParseJson('{\\"msg\\":\\"say \\\\\\"hi\\\\\\"\\"}');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ msg: 'say "hi"' });
  });

  it("多层转义的 JSON 也能逐层还原", () => {
    // 运行时期望的文本：{\\\"a\\\":1}（对象被连续转义两层）
    const res = tryParseJson(String.raw`{\\\"a\\\":1}`);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ a: 1 });
  });

  it("普通日志 / URL / 空白内容不会被误判成 JSON", () => {
    const log =
      "= span_id= user_id=none user_id_source=none\n2026-11-13 13:31:51.176 [gm-tcp-handler-25] INFO trace_id=";
    expect(tryParseJson(log).success).toBe(false);
    expect(tryParseJson("https://prh-dev.hongyanyun.cn/").success).toBe(false);
    expect(tryParseJson("  ").success).toBe(false);
  });

  it("普通 JSON 字符串字面量按字符串返回", () => {
    const res = tryParseJson('"just a string"');
    expect(res.success).toBe(true);
    expect(res.data).toBe("just a string");
  });
});

describe("SideBySideDiffViewer (对比视图换行排版)", () => {
  beforeEach(() => {
    localStorage.removeItem(WRAP_KEY);
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(WRAP_KEY);
  });

  it("默认自动换行，完整保留原始文本的空格与换行排版", () => {
    const { container } = render(
      <SideBySideDiffViewer
        leftText={
          "= span_id= user_id=none user_id_source=none request_id=none device_id=none device_pk=none\n" +
          "2026-11-13 13:31:51.176 [gm-tcp-handler-25] INFO trace_id= span_id="
        }
        rightText="https://prh-dev.hongyanyun.cn/"
      />
    );

    expect(container.querySelectorAll(".whitespace-pre-wrap").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".whitespace-pre").length).toBe(0);
  });

  it("关闭换行后偏好写入 localStorage，下次打开仍按用户选择", () => {
    const { container, unmount } = render(
      <SideBySideDiffViewer leftText="line1\nline2" rightText="line1" />
    );

    fireEvent.click(screen.getByTitle(/切换代码自动换行/));
    expect(localStorage.getItem(WRAP_KEY)).toBe("false");
    expect(container.querySelectorAll(".whitespace-pre").length).toBeGreaterThan(0);

    unmount();
    const second = render(<SideBySideDiffViewer leftText="line1\nline2" rightText="line1" />);
    expect(second.container.querySelectorAll(".whitespace-pre").length).toBeGreaterThan(0);
  });
});

describe("JsonStudioTool 文本写入入口（禁止自动灌入）", () => {
  const readText = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    readText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
  });

  const areas = (container: HTMLElement) => container.querySelectorAll("textarea");

  it("打开时左右都为空：不读剪贴板、不恢复历史文本、不自动填示例", () => {
    localStorage.setItem("qshell_json_studio_left", "上次左侧内容");
    localStorage.setItem("qshell_json_studio_right", "上次右侧内容");
    const { container } = render(<JsonStudioTool />);

    expect(areas(container)).toHaveLength(2);
    expect(areas(container)[0].value).toBe("");
    expect(areas(container)[1].value).toBe("");
    expect(readText).not.toHaveBeenCalled();
  });

  it("点击「格式化」才从剪贴板取内容，原文放左侧、格式化结果放右侧", async () => {
    readText.mockResolvedValue('{"a":1,"b":{"c":2}}');
    const { container } = render(<JsonStudioTool />);
    expect(readText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle(/格式化左侧和右侧 JSON/));

    await waitFor(() => {
      expect(areas(container)[0].value).toBe('{"a":1,"b":{"c":2}}');
    });
    expect(areas(container)[1].value).toBe(JSON.stringify({ a: 1, b: { c: 2 } }, null, 2));
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it("手动「粘贴」按钮把剪贴板内容写入左侧", async () => {
    readText.mockResolvedValue("2026-11-13 13:31:51.176 INFO trace_id= span_id=");
    const { container } = render(<JsonStudioTool />);

    fireEvent.click(screen.getByTitle("从剪贴板粘贴到左侧"));

    await waitFor(() => {
      expect(areas(container)[0].value).toBe("2026-11-13 13:31:51.176 INFO trace_id= span_id=");
    });
  });

  it("右键/划词「格式化 JSON」派发的显式事件仍可写入左侧", () => {
    const { container } = render(<JsonStudioTool />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("qshell:inject-json-studio", { detail: { text: '{"x":1}' } }),
      );
    });

    expect(areas(container)[0].value).toBe('{"x":1}');
  });

  it("关闭弹框清空 seed，下次打开不会自动带回上次文本", () => {
    useTextFormatterStore.getState().openTextFormatter('{"seed":1}');
    expect(useTextFormatterStore.getState().seed).toBe('{"seed":1}');

    useTextFormatterStore.getState().closeTextFormatter();
    expect(useTextFormatterStore.getState().seed).toBe("");
  });
});
