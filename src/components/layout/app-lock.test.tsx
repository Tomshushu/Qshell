import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { useAppStore } from "@/store";
import {
  hashAppLockPassword,
  verifyAppLockPassword,
  patternToKey,
} from "@/lib/app-lock";
import { AppLockOverlay } from "./app-lock-overlay";
import { AppLockSetupDialog } from "./app-lock-setup-dialog";

describe("Application Lock (Termius-like App Lock)", () => {
  beforeEach(() => {
    useAppStore.setState({
      appLockEnabled: false,
      appLockType: "password",
      appLockPasswordHash: null,
      appLockIdleMinutes: 0,
      appLockOnStartup: false,
      isAppLocked: false,
    });
  });

  afterEach(cleanup);

  describe("Password hashing & verification", () => {
    it("hashes and verifies password correctly", async () => {
      const password = "mySecretPassword123";
      const hash = await hashAppLockPassword(password);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64); // SHA-256 hex is 64 chars

      const isCorrect = await verifyAppLockPassword(password, hash);
      expect(isCorrect).toBe(true);

      const isWrong = await verifyAppLockPassword("wrongPassword", hash);
      expect(isWrong).toBe(false);
    });
  });

  describe("AppLockOverlay", () => {
    it("renders nothing when isAppLocked is false", () => {
      const { container } = render(
        <I18nProvider>
          <AppLockOverlay />
        </I18nProvider>
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders lock overlay when isAppLocked is true and unlocks on correct password", async () => {
      const hash = await hashAppLockPassword("pass123");
      useAppStore.setState({
        appLockEnabled: true,
        appLockPasswordHash: hash,
        isAppLocked: true,
      });

      render(
        <I18nProvider>
          <AppLockOverlay />
        </I18nProvider>
      );

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText(/应用已锁定|Application Locked/i)).toBeDefined();

      const input = screen.getByPlaceholderText(/输入解锁密码以继续|Enter passcode to unlock/i);
      const unlockBtn = screen.getByRole("button", { name: /解锁应用|Unlock Application/i });

      // Try wrong password
      fireEvent.change(input, { target: { value: "wrong" } });
      fireEvent.click(unlockBtn);

      await waitFor(() => {
        expect(screen.getByText(/密码错误|Incorrect passcode/i)).toBeDefined();
      });
      expect(useAppStore.getState().isAppLocked).toBe(true);

      // Enter correct password
      fireEvent.change(input, { target: { value: "pass123" } });
      fireEvent.click(unlockBtn);

      await waitFor(() => {
        expect(useAppStore.getState().isAppLocked).toBe(false);
      });
    });

    it("automatically unlocks on matching password input without needing to click submit or press enter (Windows-like unlock)", async () => {
      const hash = await hashAppLockPassword("autoPass99");
      useAppStore.setState({
        appLockEnabled: true,
        appLockPasswordHash: hash,
        isAppLocked: true,
      });

      render(
        <I18nProvider>
          <AppLockOverlay />
        </I18nProvider>
      );

      const input = screen.getByPlaceholderText(/输入解锁密码以继续|Enter passcode to unlock/i);

      // 仅输入前缀部分密码，未完全匹配，保持锁定状态
      fireEvent.change(input, { target: { value: "autoPass" } });
      expect(useAppStore.getState().isAppLocked).toBe(true);

      // 从前到后完整输入匹配密码，无需按回车或点击按钮，自动直接解锁
      fireEvent.change(input, { target: { value: "autoPass99" } });
      await waitFor(() => {
        expect(useAppStore.getState().isAppLocked).toBe(false);
      });
    });

    it("safely resets application lock and terminates all sessions on forgotten passcode", async () => {
      const hash = await hashAppLockPassword("pass123");
      const closeAllTabsSpy = vi.fn();
      useAppStore.setState({
        appLockEnabled: true,
        appLockPasswordHash: hash,
        isAppLocked: true,
        closeAllTabs: closeAllTabsSpy,
      });

      render(
        <I18nProvider>
          <AppLockOverlay />
        </I18nProvider>
      );

      // 点击“忘记密码？安全重置”
      const forgotBtn = screen.getByRole("button", { name: /忘记密码？安全重置|Forgot Passcode/i });
      fireEvent.click(forgotBtn);

      // 显示二次确认视图
      expect(screen.getByText(/确认重置应用锁？|Reset Application Lock\?/i)).toBeDefined();

      // 点击取消，返回正常输入视图
      const cancelBtn = screen.getByRole("button", { name: /取消|Cancel/i });
      fireEvent.click(cancelBtn);
      expect(screen.getByPlaceholderText(/输入解锁密码以继续|Enter passcode to unlock/i)).toBeDefined();

      // 再次点击进入确认视图并执行重置
      const forgotBtnAgain = screen.getByRole("button", { name: /忘记密码？安全重置|Forgot Passcode/i });
      fireEvent.click(forgotBtnAgain);

      const confirmResetBtn = screen.getByRole("button", { name: /确认重置并掐断连接|Reset & Disconnect All/i });
      fireEvent.click(confirmResetBtn);

      // 验证 closeAllTabs(true) 强制掐断被调用
      expect(closeAllTabsSpy).toHaveBeenCalledWith(true);
      // 验证锁已解除且密码配置已清空
      expect(useAppStore.getState().isAppLocked).toBe(false);
      expect(useAppStore.getState().appLockEnabled).toBe(false);
      expect(useAppStore.getState().appLockPasswordHash).toBeNull();
    });

    it("renders pattern lock and unlocks when drawing correct pattern", async () => {
      const pattern = [0, 1, 2, 5, 8];
      const key = patternToKey(pattern);
      const hash = await hashAppLockPassword(key);
      useAppStore.setState({
        appLockEnabled: true,
        appLockType: "pattern",
        appLockPasswordHash: hash,
        isAppLocked: true,
      });

      render(
        <I18nProvider>
          <AppLockOverlay />
        </I18nProvider>
      );

      expect(screen.getByText(/请绘制图案以解锁|Draw pattern to unlock/i)).toBeDefined();
      const svg = screen.getByTestId("pattern-lock-svg");
      svg.getBoundingClientRect = vi.fn(() => ({
        width: 300,
        height: 300,
        top: 0,
        left: 0,
        right: 300,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Draw correct pattern: 0 -> 1 -> 2 -> 5 -> 8
      fireEvent.pointerDown(svg, { clientX: 60, clientY: 60, button: 0 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 60 });
      fireEvent.pointerMove(svg, { clientX: 240, clientY: 60 });
      fireEvent.pointerMove(svg, { clientX: 240, clientY: 150 });
      fireEvent.pointerMove(svg, { clientX: 240, clientY: 240 });
      fireEvent.pointerUp(svg);

      await waitFor(() => {
        expect(useAppStore.getState().isAppLocked).toBe(false);
      });
    });
  });

  describe("AppLockSetupDialog", () => {
    it("sets up application lock with new password", async () => {
      const handleClose = vi.fn();
      render(
        <I18nProvider>
          <AppLockSetupDialog
            open={true}
            mode="setup"
            onClose={handleClose}
          />
        </I18nProvider>
      );

      const pwdInput = screen.getByPlaceholderText(/设置应用锁密码|Set passcode/i);
      const confirmInput = screen.getByPlaceholderText(/再次输入上方密码|Re-enter passcode above/i);
      const saveBtn = screen.getByRole("button", { name: /保存|Save/i });

      fireEvent.change(pwdInput, { target: { value: "newPass999" } });
      fireEvent.change(confirmInput, { target: { value: "newPass999" } });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(useAppStore.getState().appLockEnabled).toBe(true);
        expect(useAppStore.getState().appLockPasswordHash).not.toBeNull();
      });

      const hash = useAppStore.getState().appLockPasswordHash;
      const verified = await verifyAppLockPassword("newPass999", hash);
      expect(verified).toBe(true);
      expect(handleClose).toHaveBeenCalled();
    });

    it("validates confirm password matching in real-time as user types", async () => {
      render(
        <I18nProvider>
          <AppLockSetupDialog
            open={true}
            mode="setup"
            onClose={vi.fn()}
          />
        </I18nProvider>
      );

      const pwdInput = screen.getByPlaceholderText(/设置应用锁密码|Set passcode/i);
      const confirmInput = screen.getByPlaceholderText(/再次输入上方密码|Re-enter passcode above/i);

      fireEvent.change(pwdInput, { target: { value: "secret123" } });

      // 输入不匹配的前缀字符，实时显示密码不一致警告
      fireEvent.change(confirmInput, { target: { value: "wrong" } });
      expect(screen.getByText(/两次输入的密码不一致|Passcodes do not match/i)).toBeDefined();

      // 输入完全相同的密码，实时显示密码一致提示
      fireEvent.change(confirmInput, { target: { value: "secret123" } });
      expect(screen.getByText(/密码一致|Passcodes match/i)).toBeDefined();
      expect(screen.queryByText(/两次输入的密码不一致|Passcodes do not match/i)).toBeNull();
    });

    it("sets up application lock with 9-dot pattern lock", async () => {
      const handleClose = vi.fn();
      render(
        <I18nProvider>
          <AppLockSetupDialog
            open={true}
            mode="setup"
            onClose={handleClose}
          />
        </I18nProvider>
      );

      // 切换到九点图案锁 Tab
      const patternTab = screen.getByRole("button", { name: /九点图案锁|Pattern Lock/i });
      fireEvent.click(patternTab);

      expect(screen.getByText(/请绘制解锁图案|Draw an unlock pattern/i)).toBeDefined();

      const svg = screen.getByTestId("pattern-lock-svg");
      svg.getBoundingClientRect = vi.fn(() => ({
        width: 300,
        height: 300,
        top: 0,
        left: 0,
        right: 300,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // 首次绘制图案: 0 -> 1 -> 4 -> 7
      fireEvent.pointerDown(svg, { clientX: 60, clientY: 60, button: 0 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 60 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 150 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 240 });
      fireEvent.pointerUp(svg);

      // 进入再次绘制确认阶段
      await waitFor(() => {
        expect(screen.getByText(/请再次绘制图案以确认|Draw pattern again to confirm/i)).toBeDefined();
      });

      // 再次绘制相同图案确认
      fireEvent.pointerDown(svg, { clientX: 60, clientY: 60, button: 0 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 60 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 150 });
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 240 });
      fireEvent.pointerUp(svg);

      await waitFor(() => {
        expect(screen.getByText(/图案一致|Patterns match/i)).toBeDefined();
      });

      // 点击保存
      const saveBtn = screen.getByRole("button", { name: /保存|Save/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(useAppStore.getState().appLockEnabled).toBe(true);
        expect(useAppStore.getState().appLockType).toBe("pattern");
      });

      const hash = useAppStore.getState().appLockPasswordHash;
      expect(hash).not.toBeNull();
      const verified = await verifyAppLockPassword(patternToKey([0, 1, 4, 7]), hash);
      expect(verified).toBe(true);
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
