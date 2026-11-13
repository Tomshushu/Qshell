import { create } from "zustand";

/** 全局文本格式化器状态：桥接「顶部按钮」「终端选中」与「全局浮动弹框」 */
interface TextFormatterState {
  open: boolean;
  /** 预填充内容：只允许由用户主动入口（右键/划词「格式化 JSON」、弹框内读取剪贴板）写入 */
  seed: string;
  openTextFormatter: (seed?: string) => void;
  closeTextFormatter: () => void;
  toggleTextFormatter: (seed?: string) => void;
}

export const useTextFormatterStore = create<TextFormatterState>((set) => ({
  open: false,
  seed: "",
  openTextFormatter: (seed = "") => set({ open: true, seed }),
  // 关闭时清空 seed，避免下次打开弹框时把上次的文本自动带回
  closeTextFormatter: () => set({ open: false, seed: "" }),
  toggleTextFormatter: (seed = "") =>
    set((state) => (state.open ? { open: false, seed: "" } : { open: true, seed })),
}));
