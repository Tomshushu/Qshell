import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ComposeBar } from "../compose-bar";
import { useAppStore } from "@/store";
import { sshService } from "@/services/ssh-service";
import * as riskEvaluator from "@/services/ai/risk-evaluator";

// Mock sshService
vi.mock("@/services/ssh-service", () => ({
  sshService: {
    writeToShell: vi.fn().mockResolvedValue(undefined),
    isSessionAlive: vi.fn().mockReturnValue(true),
    getTabActiveSessionId: vi.fn((tabId: string) => `session-${tabId}`),
    addFavCmd: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock i18n
vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const map: Record<string, string> = {
        compose_bar_title: "撰写",
        compose_bar_placeholder_single: "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)",
        compose_bar_placeholder_multi: "在此编写或粘贴多行 Shell 脚本... (按下方按钮或快捷键批量发送)",
        compose_target_active: "仅发送到当前会话",
        compose_target_split: "发送到当前可见窗口",
        compose_target_color: "发送到标签颜色",
        compose_target_all: "发送到全部已连接会话",
        color_red: "红色",
        compose_send_enter: "使用 Enter 发送",
        compose_send_ctrl_enter: "使用 Ctrl+Enter 发送",
        compose_line_by_line: "逐行延时发送 (20ms 节流)",
        compose_convert_escapes: "转换反斜杠转义 (\\n, \\t)",
        compose_bracketed_paste: "括号粘贴安全模式",
        compose_btn_send: "发送",
        compose_btn_expand: "展开为撰写窗口",
        compose_btn_collapse: "收起为单行撰写栏",
        compose_history_title: "历史撰写",
        compose_history_empty: "暂无历史撰写记录",
        compose_history_clear: "全部删除",
        compose_history_delete_item: "删除此条",
        compose_history_clear_confirm: "确定要全部删除所有历史撰写记录吗？此操作无法撤销。",
        compose_history_apply: "填入输入区",
        compose_history_copied: "已复制到剪贴板",
        compose_history_search_placeholder: "搜索历史撰写记录...",
        compose_save_as_fav: "保存为快捷命令",
        compose_danger_title: "高危多机广播二次确认",
        compose_danger_warning: `您即将向 ${params?.count || 1} 台服务器广播执行以下指令：`,
        compose_danger_confirm_btn: "已知晓风险，确认广播执行",
      };
      return map[key] || key;
    },
  }),
}));

// Mock sound
vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: {
    Click: "click",
  },
}));

// Mock toast
const mockToast = {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
};

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe("ComposeBar Component (终端命令撰写与多机分发系统)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      terminalComposeBarVisible: true,
      terminalComposeBarExpanded: false,
      terminalComposeBarHeight: 160,
      terminalComposeTarget: "active",
      terminalComposeSendMode: "enter",
      terminalComposeLineByLine: false,
      terminalComposeConvertEscapes: true,
      terminalComposeHistory: [],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "ws-1",
          serverId: "srv-1",
          serverName: "Server Alpha",
          module: "terminal",
          title: "Tab 1",
        },
        {
          id: "tab-2",
          workspaceId: "ws-1",
          serverId: "srv-2",
          serverName: "Server Beta",
          module: "terminal",
          title: "Tab 2",
        },
      ] as any,
      workspaces: {
        "ws-1": {
          id: "ws-1",
          layout: {
            type: "split",
            id: "s1",
            children: [
              { type: "group", groupId: "g1" },
              { type: "group", groupId: "g2" },
            ],
          },
        },
      } as any,
      servers: [
        {
          id: "srv-1",
          name: "Server Alpha",
          host: "192.168.1.10",
          port: 22,
          username: "root",
        },
        {
          id: "srv-2",
          name: "Server Beta",
          host: "192.168.1.20",
          port: 22,
          username: "admin",
        },
      ] as any,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not render when terminalComposeBarVisible is false", () => {
    useAppStore.setState({ terminalComposeBarVisible: false });
    const { container } = render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders compact single-line mode by default", () => {
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );
    expect(
      screen.getByPlaceholderText(
        "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
      )
    ).toBeTruthy();
    expect(screen.getByText("当前会话")).toBeTruthy();
  });

  it("switches to multiline expanded mode when expand button is clicked", () => {
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const expandBtn = screen.getByTitle("展开为撰写窗口");
    fireEvent.click(expandBtn);

    expect(useAppStore.getState().terminalComposeBarExpanded).toBe(true);
    expect(
      screen.getByPlaceholderText(
        "在此编写或粘贴多行 Shell 脚本... (按下方按钮或快捷键批量发送)"
      )
    ).toBeTruthy();
  });

  it("dispatches single command to active terminal on Enter key in single-line mode", async () => {
    const focusMock = vi.fn();
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
        onFocusTerminal={focusMock}
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "uname -a" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sshService.writeToShell).toHaveBeenCalledWith("sess-1", "uname -a\r");
      expect((input as HTMLInputElement).value).toBe("");
    });
    expect(focusMock).toHaveBeenCalled();
    expect(useAppStore.getState().terminalComposeHistory).toContain("uname -a");
  });

  it("broadcasts command to all split terminals when target is 'split'", async () => {
    useAppStore.setState({ terminalComposeTarget: "split" });
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "uptime" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-1", "uptime\r");
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-2", "uptime\r");
    });
  });

  it("broadcasts command to all connected tabs when target is 'all'", async () => {
    useAppStore.setState({ terminalComposeTarget: "all" });
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "hostname" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-1", "hostname\r");
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-2", "hostname\r");
    });
  });

  it("blocks destructive command (rm -rf /) via hard block security guard", async () => {
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "rm -rf /" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(sshService.writeToShell).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("针对系统根目录的强制递归删除操作")
    );
  });

  it("prompts secondary confirmation dialog on dangerous command with target server list", async () => {
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "reboot" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Should open danger confirmation modal
    expect(screen.getByText("高危多机广播二次确认")).toBeTruthy();
    expect(screen.getByText("Server Alpha")).toBeTruthy();

    // Click confirm
    const confirmBtn = screen.getByText("已知晓风险，确认广播执行");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(sshService.writeToShell).toHaveBeenCalledWith("sess-1", "reboot\r");
    });
  });

  it("supports line-by-line throttled sending for multiline scripts", async () => {
    useAppStore.setState({
      terminalComposeBarExpanded: true,
      terminalComposeLineByLine: true,
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const textarea = screen.getByPlaceholderText(
      "在此编写或粘贴多行 Shell 脚本... (按下方按钮或快捷键批量发送)"
    );

    fireEvent.change(textarea, { target: { value: "echo 1\necho 2" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(sshService.writeToShell).toHaveBeenCalledWith("sess-1", "echo 1\r");
      expect(sshService.writeToShell).toHaveBeenCalledWith("sess-1", "echo 2\r");
      expect((textarea as HTMLTextAreaElement).value).toBe("");
    });
  });

  it("handles history navigation with ArrowUp and ArrowDown in single line mode", () => {
    useAppStore.setState({
      terminalComposeHistory: ["git status", "docker ps"],
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    ) as HTMLInputElement;

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("git status");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("docker ps");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("git status");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");
  });

  it("focuses input when 'qshell:focus-compose-bar' event is dispatched", async () => {
    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    // Blur first
    input.blur();
    expect(document.activeElement).not.toBe(input);

    // Dispatch focus event
    window.dispatchEvent(new CustomEvent("qshell:focus-compose-bar"));

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("does not show split broadcast option when not in split mode, and auto-resets target", async () => {
    // Only 1 single tab, no split workspace
    useAppStore.setState({
      tabs: [
        {
          id: "tab-solo",
          serverId: "srv-1",
          module: "terminal",
          title: "Solo Tab",
        },
      ] as any,
      workspaces: {},
      layout: { type: "group", groupId: "g-solo" },
      terminalComposeTarget: "split", // Previously selected split
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-solo"
      />
    );

    // Target should auto-reset from 'split' to 'active' because there is no split screen
    await waitFor(() => {
      expect(useAppStore.getState().terminalComposeTarget).toBe("active");
    });

    // Open target dropdown via keyboard
    const targetTrigger = screen.getByTitle("切换分发目标");
    fireEvent.keyDown(targetTrigger, { key: "ArrowDown" });

    // Should NOT have split or all broadcast options
    expect(screen.queryByText("发送到当前可见窗口")).toBeNull();
    expect(screen.queryByText("发送到全部已连接会话")).toBeNull();
    // Only active session
    expect(screen.getByText("仅发送到当前会话")).toBeTruthy();
  });

  it("broadcasts command to terminals matching color target", async () => {
    useAppStore.setState({
      tabs: [
        {
          id: "tab-red-1",
          serverId: "srv-1",
          module: "terminal",
          title: "Red Tab 1",
          color: "#ef4444",
        },
        {
          id: "tab-red-2",
          serverId: "srv-2",
          module: "terminal",
          title: "Red Tab 2",
          color: "#ef4444",
        },
        {
          id: "tab-blue-1",
          serverId: "srv-1",
          module: "terminal",
          title: "Blue Tab 1",
          color: "#3b82f6",
        },
      ] as any,
      terminalComposeTarget: "color:#ef4444",
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-red-1"
      />
    );

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    );

    fireEvent.change(input, { target: { value: "echo hello-red" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      // Both red tabs should receive the command
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-red-1", "echo hello-red\r");
      expect(sshService.writeToShell).toHaveBeenCalledWith("session-tab-red-2", "echo hello-red\r");
      // Blue tab should NOT receive it
      expect(sshService.writeToShell).not.toHaveBeenCalledWith("session-tab-blue-1", "echo hello-red\r");
    });
  });

  it("opens history dialog, deletes specific item, and fills command on select", async () => {
    useAppStore.setState({
      terminalComposeHistory: ["git status", "docker ps -a", "htop"],
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    // Click the history button (Clock icon with title "历史撰写")
    const historyBtn = screen.getByTitle("历史撰写");
    fireEvent.click(historyBtn);

    // Dialog should be open
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("git status")).toBeTruthy();
    expect(screen.getByText("docker ps -a")).toBeTruthy();
    expect(screen.getByText("htop")).toBeTruthy();

    // Delete a specific history item ("docker ps -a")
    const deleteButtons = screen.getAllByTitle("删除此条");
    expect(deleteButtons.length).toBe(3);
    fireEvent.click(deleteButtons[1]); // Delete second item

    expect(useAppStore.getState().terminalComposeHistory).toEqual(["git status", "htop"]);

    // Fill "git status" into input (clicking the item row or Enter badge)
    fireEvent.click(screen.getByText("git status"));

    const input = screen.getByPlaceholderText(
      "在此输入要发送到终端的命令... (Enter 发送，Shift+Enter 换行，Esc 退出)"
    ) as HTMLInputElement;
    expect(input.value).toBe("git status");
  });

  it("clears all history items via confirmation dialog in history modal", async () => {
    useAppStore.setState({
      terminalComposeHistory: ["command 1", "command 2"],
    });

    render(
      <ComposeBar
        activeTermId="t1"
        activeSessionId="sess-1"
        tabId="tab-1"
      />
    );

    fireEvent.click(screen.getByTitle("历史撰写"));

    // Click "全部删除" button in header
    const clearAllBtn = screen.getByText("全部删除");
    fireEvent.click(clearAllBtn);

    // Confirm dialog should appear
    expect(screen.getByText("确定要全部删除所有历史撰写记录吗？此操作无法撤销。")).toBeTruthy();

    // Click confirm in the destructive ConfirmDialog
    const confirmBtns = screen.getAllByText("全部删除");
    // The last button is the one inside ConfirmDialog footer
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    expect(useAppStore.getState().terminalComposeHistory).toEqual([]);
  });
});
