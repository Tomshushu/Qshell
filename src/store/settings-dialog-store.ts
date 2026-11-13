import { create } from "zustand";

/** 与 SettingsDialog 的 defaultTab 联合类型保持一致 */
export type SettingsTab =
  | "general"
  | "security"
  | "account"
  | "ai"
  | "terminal"
  | "sftp"
  | "logs"
  | "shortcuts"
  | "known_hosts";

interface SettingsDialogState {
  open: boolean;
  tab: SettingsTab;
  /** 打开设置；不传 tab 时保留上一次的分页（与旧的 open-settings 事件语义一致） */
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

/**
 * 设置弹框的单一 Owner。
 *
 * 之前 TabBar 与 CommandPalette 各持一份 `showSettings` state + 一份 SettingsDialog
 * 实例，两个 Radix 模态各自 Portal 到 body、互不感知。现在由全局 store 统一开关与分页，
 * App 顶层只渲染一个实例，生命周期与层级都能跟随统一的分层契约。
 */
export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  tab: "general",
  openSettings: (tab) =>
    set((state) => (tab ? { open: true, tab } : { open: true, tab: state.tab })),
  closeSettings: () => set({ open: false }),
}));
