import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { TerminalSelectionToolbar } from "./terminal-selection-toolbar";

vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: { Click: "click" },
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        tm_copy: "复制",
        tm_copied: "已复制",
        status_copied: "已复制",
        tm_paste_to_shell: "粘贴至终端",
        tm_search: "搜索",
        tm_web_search: "网页搜索",
      };
      return map[key] || key;
    },
  }),
}));

describe("TerminalSelectionToolbar", () => {
  afterEach(cleanup);

  it("does not render when visible is false or selectedText is empty", () => {
    const { container, rerender } = render(
      <TerminalSelectionToolbar
        visible={false}
        x={100}
        y={100}
        selectedText="hello"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onPasteSelection={vi.fn()}
        onSearch={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <TerminalSelectionToolbar
        visible={true}
        x={100}
        y={100}
        selectedText=""
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onPasteSelection={vi.fn()}
        onSearch={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders buttons correctly when visible with text", () => {
    render(
      <TerminalSelectionToolbar
        visible={true}
        x={150}
        y={200}
        selectedText="error 404"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onPasteSelection={vi.fn()}
        onSearch={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "复制" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "粘贴至终端" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "搜索" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "网页搜索" })).toBeTruthy();
  });

  it("handles copy action and shows feedback", async () => {
    const onCopy = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalSelectionToolbar
        visible={true}
        x={150}
        y={200}
        selectedText="test string"
        onClose={onClose}
        onCopy={onCopy}
        onPasteSelection={vi.fn()}
        onSearch={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole("button", { name: "复制" });
    fireEvent.click(copyBtn);

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已复制")).toBeTruthy();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    }, { timeout: 600 });
  });

  it("handles paste to shell action", () => {
    const onPasteSelection = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalSelectionToolbar
        visible={true}
        x={150}
        y={200}
        selectedText="docker ps"
        onClose={onClose}
        onCopy={vi.fn()}
        onPasteSelection={onPasteSelection}
        onSearch={vi.fn()}
      />
    );

    const pasteBtn = screen.getByRole("button", { name: "粘贴至终端" });
    fireEvent.click(pasteBtn);

    expect(onPasteSelection).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles search action", () => {
    const onSearch = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalSelectionToolbar
        visible={true}
        x={150}
        y={200}
        selectedText="keyword"
        onClose={onClose}
        onCopy={vi.fn()}
        onPasteSelection={vi.fn()}
        onSearch={onSearch}
      />
    );

    const searchBtn = screen.getByRole("button", { name: "搜索" });
    fireEvent.click(searchBtn);

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
