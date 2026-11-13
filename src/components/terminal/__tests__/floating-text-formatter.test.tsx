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
import { useWindowLayerStore, WINDOW_Z_BASE } from "@/store/window-layer-store";
import { useAppStore } from "@/store";

describe("FloatingTextFormatter", () => {
  beforeEach(() => {
    useTextFormatterStore.setState({ open: false, seed: "" });
    useAppStore.setState({
      activeTabId: "test-tab",
      tabs: [{ id: "test-tab", serverId: "srv-1", serverName: "Test", module: "terminal", title: "Terminal" }],
      terminalThemeId: "termius-dark",
      customTerminalThemes: [],
      terminalThemeOverrides: {},
    });
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

  it("follows terminal lifecycle: hides on non-terminal modules and closes when the tab is closed", () => {
    const view = openToolbox();
    expect(screen.getByText("开发运维工具箱")).toBeTruthy();

    // 1. 切换到文件模块（SFTP）：浮窗自动临时隐匿
    act(() => {
      useAppStore.setState({
        tabs: [{ id: "test-tab", serverId: "srv-1", serverName: "Test", module: "files", title: "Files" }],
      });
    });
    expect(view.container.firstChild).toBeNull();

    // 2. 切回终端模块：浮窗自动恢复
    act(() => {
      useAppStore.setState({
        tabs: [{ id: "test-tab", serverId: "srv-1", serverName: "Test", module: "terminal", title: "Terminal" }],
      });
    });
    expect(screen.getByText("开发运维工具箱")).toBeTruthy();

    // 3. 关闭终端标签：浮窗彻底销毁关闭
    act(() => {
      useAppStore.setState({
        tabs: [],
        activeTabId: null,
      });
    });
    expect(useTextFormatterStore.getState().open).toBe(false);
    expect(view.container.firstChild).toBeNull();
  });

  it("工具箱配色跟随应用明暗主题，不绑定终端主题", () => {
    useAppStore.setState({ terminalThemeId: "termius-dark" });
    openToolbox();

    const panel = document.querySelector(".devtools-scope") as HTMLElement;
    // 浮窗不注入终端原始色，也不自行切换 dark / colorScheme / 全局语义色
    expect(panel.hasAttribute("data-term-theme")).toBe(false);
    expect(panel.style.getPropertyValue("--dt-bg")).toBe("");
    expect(panel.style.getPropertyValue("--dt-fg")).toBe("");
    expect(panel.style.getPropertyValue("--dt-accent")).toBe("");
    expect(panel.style.colorScheme).toBe("");
    expect(panel.classList.contains("dark")).toBe(false);
    expect(panel.style.getPropertyValue("--color-background")).toBe("");

    // 明暗由 ThemeProvider 挂在根元素上的 .dark / .light 决定；
    // 同时换一套终端主题也不应改变工具箱配色。
    document.documentElement.classList.add("dark");
    try {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(panel.classList.contains("dark")).toBe(false);

      act(() => {
        useAppStore.setState({ terminalThemeId: "termius-light" });
      });
      const after = document.querySelector(".devtools-scope") as HTMLElement;
      expect(after.hasAttribute("data-term-theme")).toBe(false);
      expect(after.style.getPropertyValue("--dt-bg")).toBe("");
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("打开时自动置顶，点击浮窗可再次成为顶层", () => {
    useWindowLayerStore.setState({ layers: {}, topZ: WINDOW_Z_BASE - 1 });
    openToolbox();

    const panel = document.querySelector(".devtools-scope") as HTMLElement;
    const initialZ = Number(panel.style.zIndex);
    expect(initialZ).toBeGreaterThanOrEqual(WINDOW_Z_BASE);
    expect(useWindowLayerStore.getState().layers["devtools"]).toBe(initialZ);

    // 另一个窗口打开后抢占顶层
    useWindowLayerStore.getState().register("other-window");
    expect(useWindowLayerStore.getState().layers["other-window"]).toBeGreaterThan(initialZ);

    // 点击工具箱任意位置，重新回到最上层
    fireEvent.pointerDown(panel, { bubbles: true });
    expect(useWindowLayerStore.getState().layers["devtools"]).toBeGreaterThan(
      useWindowLayerStore.getState().layers["other-window"],
    );
    expect(Number(panel.style.zIndex)).toBe(useWindowLayerStore.getState().layers["devtools"]);
  });
});
