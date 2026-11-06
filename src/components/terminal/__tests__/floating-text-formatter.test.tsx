/**
 * src/components/terminal/__tests__/floating-text-formatter.test.tsx
 *
 * 开发运维工具箱浮窗：结构与基础交互回归测试
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FloatingTextFormatter } from "../floating-text-formatter";
import { useTextFormatterStore } from "@/store/text-formatter-store";

describe("FloatingTextFormatter", () => {
  beforeEach(() => {
    useTextFormatterStore.setState({ open: false, seed: "" });
  });

  afterEach(() => {
    cleanup();
  });

  const openToolbox = () => {
    act(() => {
      useTextFormatterStore.getState().openTextFormatter('{"hello":"world"}');
    });
    return render(<FloatingTextFormatter />);
  };

  it("renders the toolbox shell and the recommended tool for the seed", () => {
    openToolbox();
    expect(screen.getByText("开发运维工具箱")).toBeTruthy();
    expect(screen.getAllByText("JSON 格式化").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("搜索工具...")).toBeTruthy();
  });

  it("focuses the search box with Ctrl+F and clears an empty search", () => {
    openToolbox();
    const input = screen.getByPlaceholderText("搜索工具...") as HTMLInputElement;

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "不存在的工具" } });
    expect(screen.getByText("没有匹配的工具")).toBeTruthy();

    fireEvent.click(screen.getByText("清除搜索"));
    expect(input.value).toBe("");
    expect(screen.getAllByText("JSON 格式化").length).toBeGreaterThan(0);
  });

  it("closes on Escape and follows the seed when reopened", () => {
    const view = openToolbox();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTextFormatterStore.getState().open).toBe(false);
    expect(view.container.firstChild).toBeNull();

    act(() => {
      useTextFormatterStore.getState().openTextFormatter("1700000000");
    });
    expect(screen.getAllByText("时间戳转换").length).toBeGreaterThan(0);
  });
});
