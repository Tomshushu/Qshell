import type { StateCreator } from "zustand";
import { playSound, setSoundEnabled, SoundType } from "@/lib/sound";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../constants";
import type { AppState, UiSlice } from "../types";

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  // Theme
  theme: "system",
  toggleTheme: () =>
    set((state) => {
      const next =
        state.theme === "system"
          ? "light"
          : state.theme === "light"
            ? "dark"
            : "system";
      playSound(SoundType.Toggle);
      return { theme: next };
    }),
  setTheme: (theme) => set({ theme }),
  uiStyle: "ubuntu",
  setUiStyle: (uiStyle) => set({ uiStyle }),
  customCursorEnabled: true,
  setCustomCursorEnabled: (customCursorEnabled) => set({ customCursorEnabled }),

  // Language
  language: "zh-CN",
  setLanguage: (lang) => set({ language: lang }),

  // 通用（全局）设置默认值与 setter
  uiSoundEnabled: false,
  setUiSoundEnabled: (enabled) => {
    set({ uiSoundEnabled: enabled });
    // 直接同步到 sound.ts 的模块级开关，不依赖任何组件挂载
    setSoundEnabled(enabled);
  },

  // Dashboard UI
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  setSidebarWidth: (width) =>
    set({
      sidebarWidth: Math.max(
        SIDEBAR_WIDTH_MIN,
        Math.min(
          SIDEBAR_WIDTH_MAX,
          Math.round(width) || SIDEBAR_WIDTH_DEFAULT,
        ),
      ),
    }),

  // Application Lock (Termius 风格应用级离席安全锁)
  appLockEnabled: false,
  appLockType: "password",
  appLockPasswordHash: null,
  appLockIdleMinutes: 0,
  appLockOnStartup: false,
  isAppLocked: false,
  setAppLock: (enabled, passwordHash, lockType) =>
    set((state) => ({
      appLockEnabled: enabled,
      appLockPasswordHash: passwordHash,
      appLockType: lockType ?? state.appLockType ?? "password",
    })),
  setAppLockType: (lockType) => set({ appLockType: lockType }),
  setAppLockIdleMinutes: (minutes) =>
    set({ appLockIdleMinutes: Math.max(0, minutes) }),
  setAppLockOnStartup: (enabled) =>
    set({ appLockOnStartup: enabled }),
  lockApp: () => {
    set((state) => {
      // 必须已设置密码哈希才能进入锁定状态
      if (!state.appLockPasswordHash) return {};
      playSound(SoundType.Toggle);
      return { isAppLocked: true };
    });
  },
  unlockApp: () => {
    playSound(SoundType.Complete);
    set({ isAppLocked: false });
  },
});
