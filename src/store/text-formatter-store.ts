import { create } from "zustand";

/** 全局文本格式化器状态：桥接「顶部按钮」「终端选中」与「全局浮动弹框」 */
interface TextFormatterState {
  open: boolean;
  /** 预填充内容：终端选中文本等场景打开弹框时注入 */
  seed: string;
  openTextFormatter: (seed?: string) => void;
  closeTextFormatter: () => void;
}

export const useTextFormatterStore = create<TextFormatterState>((set) => ({
  open: false,
  seed: "",
  openTextFormatter: (seed = "") => set({ open: true, seed }),
  closeTextFormatter: () => set({ open: false }),
}));
