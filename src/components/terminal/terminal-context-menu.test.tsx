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
});
