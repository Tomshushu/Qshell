import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TerminalLockOverlay } from "../terminal-lock-overlay";
import { hashAppLockPassword, patternToKey } from "@/lib/app-lock";
import { useAppStore } from "@/store";
import zhCN from "@/i18n/locales/zh-CN";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    language: "zh-CN",
    t: (key: string) => (zhCN as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("@/lib/sound", () => ({
  playSound: vi.fn(),
  SoundType: {
    Error: "error",
    Complete: "complete",
    Click: "click",
    Toggle: "toggle",
    Warn: "warn",
  },
}));

describe("TerminalLockOverlay", () => {
  const sampleEntry = {
    termId: "term-1",
    tabId: "tab-1",
    serverId: "srv-1",
    lockedAt: 1000,
  };

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      appLockEnabled: false,
      appLockType: "password",
      appLockPasswordHash: null,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies and unlocks using the global app lock password", async () => {
    const hash = await hashAppLockPassword("my-secret-pwd");
    useAppStore.setState({
      appLockEnabled: true,
      appLockType: "password",
      appLockPasswordHash: hash,
    });

    const onUnlock = vi.fn();
    render(
      <TerminalLockOverlay
        entry={sampleEntry}
        sessionTitle="Prod Bastion"
        onUnlock={onUnlock}
      />,
    );

    const input = screen.getByPlaceholderText("输入应用锁密码解锁");

    // 错误密码先被拦截并提示错误
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(screen.getByText("密码错误，请重试")).toBeInTheDocument();
    });
    expect(onUnlock).not.toHaveBeenCalled();

    // 输入与全局应用锁一致的正确密码自动解锁
    fireEvent.change(input, { target: { value: "my-secret-pwd" } });
    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledWith("term-1");
    });
  });

  it("supports the 9-dot app lock pattern mode instead of trapping the user", async () => {
    const hash = await hashAppLockPassword(patternToKey([0, 1, 2, 5]));
    useAppStore.setState({
      appLockEnabled: true,
      appLockType: "pattern",
      appLockPasswordHash: hash,
    });

    const onUnlock = vi.fn();
    const { container } = render(
      <TerminalLockOverlay
        entry={sampleEntry}
        sessionTitle="Prod Pattern"
        onUnlock={onUnlock}
      />,
    );

    expect(screen.getByText("绘制应用锁图案以解锁当前工作台")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("输入应用锁密码解锁")).not.toBeInTheDocument();

    const svg = container.querySelector("svg[aria-label]")!;
    expect(svg).toBeInTheDocument();
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 错误手势：[0, 3, 6, 7]
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 60 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 150 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 240 });
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 240 });
    fireEvent.pointerUp(svg);

    await waitFor(() => {
      expect(screen.getByText("图案错误，请重试")).toBeInTheDocument();
    });
    expect(onUnlock).not.toHaveBeenCalled();

    // 正确手势：[0, 1, 2, 5]
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 60 });
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 60 });
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 60 });
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 150 });
    fireEvent.pointerUp(svg);

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledWith("term-1");
    });
  });

  it("allows unlocking safely if app lock was disabled in settings", () => {
    useAppStore.setState({
      appLockEnabled: false,
      appLockType: "password",
      appLockPasswordHash: null,
    });

    const onUnlock = vi.fn();
    render(<TerminalLockOverlay entry={sampleEntry} onUnlock={onUnlock} />);

    expect(screen.getByText("应用锁已关闭，点击可直接解锁")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "解锁当前工作台" }));
    expect(onUnlock).toHaveBeenCalledWith("term-1");
  });
});
