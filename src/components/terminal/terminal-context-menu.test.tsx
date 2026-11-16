import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TerminalContextMenu } from "./terminal-context-menu";

vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: { Click: "click" },
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        tm_copy: "复制",
        tm_copy_all: "复制全部输出",
        tm_paste: "粘贴",
        tm_paste_selected: "粘贴选中内容",
        tm_ai_diagnosis_menu: "AI 诊断选中文本",
        tm_ai_diagnosis_recent: "AI 诊断终端报错/输出",
        tm_ai_explain_shell: "拆解并解释指令 (Explain)",
        tm_search: "搜索",
        tm_upload_files_sftp: "上传文件到当前目录 (SFTP)",
        tm_upload_folder_sftp: "上传文件夹到当前目录 (SFTP)",
        tm_open_files_panel: "打开文件管理器 (工作台)",
        tm_open_sftp_tab: "打开 SFTP / FTP 标签页 (当前目录)",
        tm_zmodem_send: "ZMODEM 发送 (rz)",
        tm_zmodem_receive_hint: "ZMODEM 接收准备",
      };
      return map[key] || key;
    },
  }),
}));

describe("TerminalContextMenu", () => {
  afterEach(cleanup);

  const baseProps = {
    isLightTerminal: false,
    onClose: vi.fn(),
    onCopy: vi.fn(),
    onCopyAll: vi.fn(),
    onPaste: vi.fn(),
    onPasteSelection: vi.fn(),
    onSearch: vi.fn(),
    onClearScreen: vi.fn(),
    onClearScrollback: vi.fn(),
    onClearAll: vi.fn(),
    onToggleRecording: vi.fn(),
    onPauseRecording: vi.fn(),
    onResumeRecording: vi.fn(),
    onOpenLogFile: vi.fn(),
    onOpenLogFolder: vi.fn(),
    onChooseLogDirectory: vi.fn(),
    activeTermId: "term_1",
    recordingTermIds: new Set<string>(),
    recordingPausedIds: new Set<string>(),
    isOpening: false,
  };

  it("returns null when ctxMenu is null", () => {
    const { container } = render(
      <TerminalContextMenu {...baseProps} ctxMenu={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders AI 诊断选中文本 when hasSelection is true", () => {
    const onAIDiagnosis = vi.fn();
    const onAIDiagnoseRecent = vi.fn();

    render(
      <TerminalContextMenu
        {...baseProps}
        ctxMenu={{ x: 100, y: 100, hasSelection: true }}
        onAIDiagnosis={onAIDiagnosis}
        onAIDiagnoseRecent={onAIDiagnoseRecent}
      />
    );

    const diagnoseSelectedBtn = screen.getByText("AI 诊断选中文本");
    expect(diagnoseSelectedBtn).toBeTruthy();
    expect(screen.queryByText("AI 诊断终端报错/输出")).toBeNull();

    fireEvent.click(diagnoseSelectedBtn);
    expect(onAIDiagnosis).toHaveBeenCalled();
    expect(onAIDiagnoseRecent).not.toHaveBeenCalled();
  });

  it("renders AI 诊断终端报错/输出 when hasSelection is false and calls onAIDiagnoseRecent", () => {
    const onAIDiagnosis = vi.fn();
    const onAIDiagnoseRecent = vi.fn();

    render(
      <TerminalContextMenu
        {...baseProps}
        ctxMenu={{ x: 100, y: 100, hasSelection: false }}
        onAIDiagnosis={onAIDiagnosis}
        onAIDiagnoseRecent={onAIDiagnoseRecent}
      />
    );

    const diagnoseRecentBtn = screen.getByTestId("terminal-menu-ai-diagnose-recent");
    expect(diagnoseRecentBtn).toBeTruthy();
    expect(screen.getByText("AI 诊断终端报错/输出")).toBeTruthy();
    expect(screen.queryByText("AI 诊断选中文本")).toBeNull();

    fireEvent.click(diagnoseRecentBtn);
    expect(onAIDiagnoseRecent).toHaveBeenCalled();
    expect(onAIDiagnosis).not.toHaveBeenCalled();
  });

  it("renders 拆解并解释指令 (Explain) when hasSelection is true and calls onAIExplainShell", () => {
    const onAIExplainShell = vi.fn();

    render(
      <TerminalContextMenu
        {...baseProps}
        ctxMenu={{ x: 100, y: 100, hasSelection: true }}
        onAIExplainShell={onAIExplainShell}
      />
    );

    const explainBtn = screen.getByTestId("terminal-menu-ai-explain-shell");
    expect(explainBtn).toBeTruthy();
    expect(screen.getByText("拆解并解释指令 (Explain)")).toBeTruthy();

    fireEvent.click(explainBtn);
    expect(onAIExplainShell).toHaveBeenCalledTimes(1);
  });

  it("hides 传输与文件 submenu when canTransferFiles is false and invokes all transfer actions when enabled", () => {
    const onUploadFiles = vi.fn();
    const onUploadFolder = vi.fn();
    const onOpenSftp = vi.fn();
    const onOpenSftpTab = vi.fn();
    const onSendZmodem = vi.fn();
    const onReceiveZmodem = vi.fn();

    const { rerender } = render(
      <TerminalContextMenu
        {...baseProps}
        ctxMenu={{ x: 100, y: 100, hasSelection: false }}
        canTransferFiles={false}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        onOpenSftp={onOpenSftp}
        onOpenSftpTab={onOpenSftpTab}
        onSendZmodem={onSendZmodem}
        onReceiveZmodem={onReceiveZmodem}
      />,
    );

    expect(screen.queryByTestId("terminal-menu-transfer-submenu")).toBeNull();

    rerender(
      <TerminalContextMenu
        {...baseProps}
        ctxMenu={{ x: 100, y: 100, hasSelection: false }}
        canTransferFiles={true}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        onOpenSftp={onOpenSftp}
        onOpenSftpTab={onOpenSftpTab}
        onSendZmodem={onSendZmodem}
        onReceiveZmodem={onReceiveZmodem}
      />,
    );

    expect(screen.getByTestId("terminal-menu-transfer-submenu")).toBeTruthy();

    fireEvent.click(screen.getByText("上传文件到当前目录 (SFTP)"));
    expect(onUploadFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("上传文件夹到当前目录 (SFTP)"));
    expect(onUploadFolder).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("打开文件管理器 (工作台)"));
    expect(onOpenSftp).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("terminal-menu-open-sftp-tab"));
    expect(onOpenSftpTab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("ZMODEM 发送 (rz)"));
    expect(onSendZmodem).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("ZMODEM 接收准备"));
    expect(onReceiveZmodem).toHaveBeenCalledTimes(1);
  });

  it("clamps bottom submenu upward when trigger sits near bottom of viewport", () => {
    const origInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      configurable: true,
      writable: true,
    });

    try {
      const { container } = render(
        <TerminalContextMenu
          {...baseProps}
          ctxMenu={{ x: 100, y: 200, hasSelection: false }}
        />,
      );

      const logTriggerBtn = screen.getByTestId("terminal-menu-log-submenu");
      const groupContainer = logTriggerBtn.closest(".relative.group") as HTMLElement | null;
      expect(groupContainer).not.toBeNull();

      vi.spyOn(groupContainer!, "getBoundingClientRect").mockReturnValue({
        x: 100,
        y: 520,
        top: 520,
        left: 100,
        bottom: 556,
        right: 340,
        width: 240,
        height: 36,
        toJSON: () => ({}),
      });

      fireEvent.mouseEnter(groupContainer!);

      const submenuWrappers = Array.from(
        container.querySelectorAll('[data-testid="terminal-submenu-wrapper"]'),
      ) as HTMLElement[];
      const logWrapper = groupContainer!.querySelector(
        '[data-testid="terminal-submenu-wrapper"]',
      ) as HTMLElement | null;

      expect(submenuWrappers.length).toBeGreaterThan(0);
      expect(logWrapper).not.toBeNull();
      const topPx = parseFloat(logWrapper!.style.top);
      expect(Number.isFinite(topPx)).toBe(true);
      expect(topPx).toBeLessThan(-4);
      // With trigger top=520, estimatedHeight=320, vh=600, pad=6: clampedTop = 600 - 320 - 6 = 274, offsetTop = -246
      expect(520 + topPx + 320).toBeLessThanOrEqual(600 - 6);
    } finally {
      Object.defineProperty(window, "innerHeight", {
        value: origInnerHeight,
        configurable: true,
        writable: true,
      });
    }
  });
});
