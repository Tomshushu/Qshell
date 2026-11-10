import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QuickCommandBar } from "../quick-command-bar";
import { QuickCommandDialog } from "../quick-command-dialog";
import { sshService } from "@/services/ssh-service";
import type { FavoriteCommand } from "@/services/api/types";
import { useAppStore } from "@/store";

vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: { Click: "click", Toggle: "toggle" },
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        quick_cmd_bar: "快捷命令",
        quick_cmd_add: "添加快捷命令",
        quick_cmd_edit: "编辑快捷命令",
        quick_cmd_name: "名称/标签",
        quick_cmd_command: "命令内容",
        quick_cmd_auto_exec: "点击直接执行 (Enter)",
        quick_cmd_auto_exec_desc: "开启后点击按钮立即执行；关闭则仅将命令填入终端命令行",
        quick_cmd_pinned: "固定在快捷栏",
        quick_cmd_pinned_desc: "固定后在底栏直观展示，方便一键点击",
        quick_cmd_color: "颜色标签",
        quick_cmd_input_placeholder: "输入命令回车快速发送 (Shift+Enter 填入不执行)...",
        quick_cmd_empty: "暂无快捷命令",
        quick_cmd_empty_hint: "点击右侧 + 号即可添加常用快捷命令",
        quick_cmd_execute: "执行",
        quick_cmd_insert: "填入命令行",
        quick_cmd_delete: "删除",
        quick_cmd_send_btn: "发送",
        quick_cmd_collapse: "收起快捷栏",
        quick_cmd_expand: "展开快捷栏",
        quick_cmd_toggle_menu: "显示快捷命令栏",
        common_save: "保存",
        common_cancel: "取消",
        common_edit: "编辑",
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
    color: "#3b82f6",
  },
  {
    id: "fav-2",
    cmd: "git status",
    desc: "Git 状态",
    createdAt: 1001,
    autoExecute: false,
    pinnedToBar: true,
  },
];

describe("QuickCommandBar Component", () => {
  beforeEach(() => {
    vi.spyOn(sshService, "listFavCmds").mockResolvedValue(mockCommands);
    vi.spyOn(sshService, "onDataMutated").mockReturnValue(() => {});
    useAppStore.setState({
      terminalQuickCommandBarVisible: true,
      terminalQuickCommandBarCollapsed: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders pinned commands and quick input", async () => {
    const onSendCommand = vi.fn();
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={onSendCommand}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
      expect(screen.getByText("Git 状态")).toBeTruthy();
    });

    expect(
      screen.getByPlaceholderText(/输入命令回车快速发送/)
    ).toBeTruthy();
  });

  it("clicks a command with autoExecute=true and triggers execution", async () => {
    const onSendCommand = vi.fn();
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={onSendCommand}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("查看内存")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("查看内存"));
    expect(onSendCommand).toHaveBeenCalledWith("free -h", true);
  });

  it("clicks a command with autoExecute=false and triggers insert without enter", async () => {
    const onSendCommand = vi.fn();
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={onSendCommand}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Git 状态")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Git 状态"));
    expect(onSendCommand).toHaveBeenCalledWith("git status", false);
  });

  it("submits command from quick input on Enter", async () => {
    const onSendCommand = vi.fn();
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={onSendCommand}
      />
    );

    const input = screen.getByPlaceholderText(/输入命令回车快速发送/);
    fireEvent.change(input, { target: { value: "uptime" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSendCommand).toHaveBeenCalledWith("uptime", true);
  });

  it("submits command from quick input on Shift+Enter without autoExecute", async () => {
    const onSendCommand = vi.fn();
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={onSendCommand}
      />
    );

    const input = screen.getByPlaceholderText(/输入命令回车快速发送/);
    fireEvent.change(input, { target: { value: "docker logs" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSendCommand).toHaveBeenCalledWith("docker logs", false);
  });

  it("renders collapsed floating pill when collapsed", async () => {
    useAppStore.setState({ terminalQuickCommandBarCollapsed: true });
    render(
      <QuickCommandBar
        activeTermId="term-1"
        onSendCommand={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("展开快捷栏")).toBeTruthy();
    });
  });
});

describe("QuickCommandDialog Component", () => {
  afterEach(cleanup);

  it("allows adding a new command and validates required fields", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <QuickCommandDialog
        open={true}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );

    // Save button disabled initially when cmd is empty
    const saveBtn = screen.getByText("保存") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Fill command and description
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "磁盘空间" } });
    fireEvent.change(inputs[1], { target: { value: "df -h" } });

    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        cmd: "df -h",
        desc: "磁盘空间",
        autoExecute: true,
        pinnedToBar: true,
        color: undefined,
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
