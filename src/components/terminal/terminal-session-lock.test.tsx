import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TerminalLockDialog, TerminalLockOverlay } from "./terminal-session-lock";

describe("TerminalLockDialog", () => {
  afterEach(cleanup);
  it("renders when open and triggers onConfirmLock with entered password", () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    render(
      <I18nProvider>
        <TerminalLockDialog
          open={true}
          onClose={handleClose}
          onConfirmLock={handleConfirm}
          serverName="Prod-Server-1"
        />
      </I18nProvider>
    );

    const inputs = screen.getAllByPlaceholderText(/设置本次锁屏的临时解锁密码|Enter temporary password/i);
    expect(inputs.length).toBeGreaterThan(0);

    // Enter password
    fireEvent.change(inputs[0], { target: { value: "secret123" } });

    // Submit form
    const submitBtn = screen.getByRole("button", { name: /立即锁定|Lock Now/i });
    fireEvent.click(submitBtn);

    expect(handleConfirm).toHaveBeenCalledWith("secret123");
    expect(handleClose).toHaveBeenCalled();
  });

  it("shows error when password confirmation mismatches", () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    render(
      <I18nProvider>
        <TerminalLockDialog
          open={true}
          onClose={handleClose}
          onConfirmLock={handleConfirm}
        />
      </I18nProvider>
    );

    const pwdInput = screen.getByPlaceholderText(/设置本次锁屏的临时解锁密码|Enter temporary password/i);
    const confirmInput = screen.getByPlaceholderText(/留空则直接使用上方密码|Leave empty to use password/i);

    fireEvent.change(pwdInput, { target: { value: "pass1" } });
    fireEvent.change(confirmInput, { target: { value: "pass2" } });

    const submitBtn = screen.getByRole("button", { name: /立即锁定|Lock Now/i });
    fireEvent.click(submitBtn);

    expect(handleConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/两次输入的密码不一致|Passwords do not match/i)).toBeTruthy();
  });
});

describe("TerminalLockOverlay", () => {
  afterEach(cleanup);

  it("verifies expected password and unlocks upon match", () => {
    const handleUnlock = vi.fn();

    render(
      <I18nProvider>
        <TerminalLockOverlay
          serverName="Prod-Server-1"
          expectedPassword="my-session-pin"
          onUnlock={handleUnlock}
        />
      </I18nProvider>
    );

    expect(screen.getByText(/Prod-Server-1/i)).toBeTruthy();
    const input = screen.getByPlaceholderText(/输入解锁密码以继续|Enter password to unlock/i);

    // Wrong password
    fireEvent.change(input, { target: { value: "wrong" } });
    const unlockBtn = screen.getByRole("button", { name: /解锁会话|Unlock Session/i });
    fireEvent.click(unlockBtn);

    expect(handleUnlock).not.toHaveBeenCalled();
    expect(screen.getByText(/密码错误，请重新输入|Incorrect password/i)).toBeTruthy();

    // Correct password
    fireEvent.change(input, { target: { value: "my-session-pin" } });
    fireEvent.click(unlockBtn);

    expect(handleUnlock).toHaveBeenCalled();
  });
});
