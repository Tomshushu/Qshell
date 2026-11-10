import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QuickCommandPaletteModal } from "../quick-command-palette-modal";
import { sshService } from "@/services/ssh-service";
import type { FavoriteCommand } from "@/services/api/types";

vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: { Click: "click", Toggle: "toggle" },
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        quick_cmd_bar: "快捷命令",
        quick_cmd_add: "新建命令",
        quick_cmd_edit: "编辑快捷命令",
        quick_cmd_name: "名称/标签",
        quick_cmd_name_placeholder: "例：查看内存状态",
        quick_cmd_command: "命令内容",
        quick_cmd_command_placeholder: "例：free -h 或 docker ps",
        quick_cmd_auto_exec: "点击直接执行 (Enter)",
        quick_cmd_auto_exec_desc: "开启后点击按钮立即执行；关闭则仅将命令填入终端命令行",
        quick_cmd_pinned: "固定在快捷栏",
        quick_cmd_pinned_desc: "固定后在底栏直观展示，方便一键点击",
        quick_cmd_color: "颜色标签",
        quick_cmd_empty: "暂无快捷命令",
        quick_cmd_modal_search: "搜索快捷命令... (↑↓ 选择，Enter 执行，Shift+Enter 填入)",
        quick_cmd_execute: "执行",
        quick_cmd_insert: "填入命令行",
        quick_cmd_delete: "删除",
        common_save: "保存",
        common_cancel: "取消",
        common_close: "关闭",
        common_back: "返回",
      };
      return map[key] || key;
    },
  }),
}));

const mockCommands: FavoriteCommand[] = [
  {
    id: "fav-1",
    cmd: "free -h",
    desc: "查看内存",
    createdAt: 1000,
    autoExecute: true,
    pinnedToBar: true,
    color: "blue",
  },
  {
    id: "fav-2",
    cmd: "git status",
    desc: "Git 状态",
    createdAt: 2000,
    autoExecute: false,
    pinnedToBar: false,
    color: "emerald",
  },
];

describe("QuickCommandPaletteModal", () => {
  beforeEach(() => {
    vi.spyOn(sshService, "listFavCmds").mockResolvedValue([...mockCommands]);
    vi.spyOn(sshService, "addFavCmd").mockResolvedValue({ success: true } as any);
    vi.spyOn(sshService, "updateFavCmd").mockResolvedValue({ success: true } as any);
    vi.spyOn(sshService, "deleteFavCmd").mockResolvedValue({ success: true } as any);
    vi.spyOn(sshService, "onDataMutated").mockReturnValue(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens when qshell:toggle-quick-commands event is dispatched", async () => {
    render(<QuickCommandPaletteModal />);
    expect(screen.queryByPlaceholderText(/搜索快捷命令/)).toBeNull();

    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索快捷命令/)).toBeTruthy();
    });
  });

  it("opens when Alt+C keyboard shortcut is pressed", async () => {
    render(<QuickCommandPaletteModal />);
    expect(screen.queryByPlaceholderText(/搜索快捷命令/)).toBeNull();

    fireEvent.keyDown(window, { key: "c", code: "KeyC", altKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索快捷命令/)).toBeTruthy();
    });
  });

  it("renders command items with labels and snippets", async () => {
    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
      expect(screen.getByText("Git 状态")).toBeTruthy();
      expect(screen.getByText("free -h")).toBeTruthy();
      expect(screen.getByText("git status")).toBeTruthy();
    });
  });

  it("filters command list when typing in search input", async () => {
    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索快捷命令/)).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/搜索快捷命令/);
    fireEvent.change(searchInput, { target: { value: "Git" } });

    expect(screen.getByText("Git 状态")).toBeTruthy();
    expect(screen.queryByText("查看内存")).toBeNull();
  });

  it("dispatches insert-terminal-command event with execute=true on Enter", async () => {
    const insertHandler = vi.fn();
    window.addEventListener("insert-terminal-command", insertHandler);

    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/搜索快捷命令/);
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(insertHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          command: "free -h",
          execute: true,
          source: "quick-command",
        },
      })
    );

    window.removeEventListener("insert-terminal-command", insertHandler);
  });

  it("dispatches insert-terminal-command with execute=false on Shift+Enter", async () => {
    const insertHandler = vi.fn();
    window.addEventListener("insert-terminal-command", insertHandler);

    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/搜索快捷命令/);
    fireEvent.keyDown(searchInput, { key: "Enter", shiftKey: true });

    expect(insertHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          command: "free -h",
          execute: false,
          source: "quick-command",
        },
      })
    );

    window.removeEventListener("insert-terminal-command", insertHandler);
  });

  it("navigates selection with ArrowDown and ArrowUp keys", async () => {
    const insertHandler = vi.fn();
    window.addEventListener("insert-terminal-command", insertHandler);

    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/搜索快捷命令/);
    // Arrow down to 2nd item
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(insertHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          command: "git status",
          execute: false, // autoExecute is false for git status
          source: "quick-command",
        },
      })
    );

    window.removeEventListener("insert-terminal-command", insertHandler);
  });

  it("switches to inline form mode on new command and returns back to list on cancel/save", async () => {
    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("新建命令")).toBeTruthy();
    });

    // Click "新建命令"
    fireEvent.click(screen.getByText("新建命令"));

    // Verify it switched to form mode inside the same dialog
    await waitFor(() => {
      expect(screen.getByText("返回")).toBeTruthy();
      expect(screen.getByPlaceholderText(/free -h 或 docker ps/)).toBeTruthy();
    });

    // Click "返回"
    fireEvent.click(screen.getByText("返回"));

    // Verify it returned back to list view
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索快捷命令/)).toBeTruthy();
    });
  });

  it("supports keyboard Alt+Down/Up and pointer dragging to reorder items and calls setAllFavCmds", async () => {
    const setAllSpy = vi.spyOn(sshService, "setAllFavCmds").mockResolvedValue({ success: true } as any);

    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
      expect(screen.getByText("Git 状态")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/搜索快捷命令/);

    // Test 1: Alt+ArrowDown to move item 0 to item 1
    fireEvent.keyDown(searchInput, { key: "ArrowDown", altKey: true });

    await waitFor(() => {
      expect(setAllSpy).toHaveBeenCalledTimes(1);
    });

    // Test 2: Pointer drag
    const items = screen.getAllByTitle(/按住鼠标拖动排序/).map((el) => el.closest(".group") as HTMLElement);
    expect(items.length).toBe(2);

    // Mock getBoundingClientRect
    items[0]!.getBoundingClientRect = vi.fn().mockReturnValue({ top: 100, bottom: 140 });
    items[1]!.getBoundingClientRect = vi.fn().mockReturnValue({ top: 140, bottom: 180 });

    fireEvent.pointerDown(items[0]!, { button: 0, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 160 }); // moved down onto item 1
    fireEvent.pointerUp(window, { clientX: 100, clientY: 160 });

    await waitFor(() => {
      expect(setAllSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("has fixed modal container dimensions and loads items incrementally on demand", async () => {
    // Generate 25 mock commands
    const manyCommands: FavoriteCommand[] = Array.from({ length: 25 }, (_, i) => ({
      id: `fav-bulk-${i}`,
      cmd: `echo test-${i}`,
      desc: `测试命令-${i}`,
      createdAt: 1000 + i,
      autoExecute: true,
      pinnedToBar: false,
    }));

    vi.spyOn(sshService, "listFavCmds").mockResolvedValue(manyCommands);

    render(<QuickCommandPaletteModal />);
    window.dispatchEvent(new CustomEvent("qshell:toggle-quick-commands"));

    // Verify initial batch of 15 items are rendered (ordered by newest createdAt desc: 24 down to 10)
    await waitFor(() => {
      expect(screen.getByText("测试命令-24")).toBeTruthy();
      expect(screen.getByText("测试命令-10")).toBeTruthy();
    });

    // Older items beyond the first batch should not be rendered yet
    expect(screen.queryByText("测试命令-0")).toBeNull();
    expect(screen.getByText(/已显示 15 \/ 共 25 条/)).toBeTruthy();

    // Trigger scroll near bottom
    const scrollContainer = screen.getByText("测试命令-24").closest(".overflow-y-auto");
    expect(scrollContainer).toBeTruthy();

    Object.defineProperty(scrollContainer, "scrollTop", { value: 300, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 720, configurable: true });

    fireEvent.scroll(scrollContainer!);

    // Should load the next batch of items (now all 25 rendered down to oldest item-0)
    await waitFor(() => {
      expect(screen.getByText("测试命令-9")).toBeTruthy();
      expect(screen.getByText("测试命令-0")).toBeTruthy();
      expect(screen.getByText("共 25 条")).toBeTruthy();
    });
  });
});
