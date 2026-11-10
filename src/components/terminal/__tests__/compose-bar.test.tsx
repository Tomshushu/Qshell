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
        compose_target_split: "发送到当前分屏所有终端",
        compose_target_all: "发送到全部已连接会话 (多机广播)",
        compose_send_enter: "使用 Enter 发送",
        compose_send_ctrl_enter: "使用 Ctrl+Enter 发送",
        compose_line_by_line: "逐行延时发送 (20ms 节流)",
        compose_convert_escapes: "转换反斜杠转义 (\\n, \\t)",
        compose_bracketed_paste: "括号粘贴安全模式",
        compose_btn_send: "发送",
        compose_btn_expand: "展开为撰写窗口",
        compose_btn_collapse: "收起为单行撰写栏",
        compose_history_title: "撰写历史记录",
        compose_history_empty: "暂无撰写历史",
        compose_history_clear: "清空历史",
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
          serverId: "srv-1",
          serverName: "Server Alpha",
          module: "terminal",
          title: "Tab 1",
        },
        {
          id: "tab-2",
          serverId: "srv-2",
          serverName: "Server Beta",
          module: "terminal",
          title: "Tab 2",
        },
      ] as any,
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
    });
    expect(focusMock).toHaveBeenCalled();
    expect(useAppStore.getState().terminalComposeHistory).toContain("uname -a");
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
});
