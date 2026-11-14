import { create } from "zustand";

interface ModalStackState {
  /** 从底到顶排列的活跃模态 ID 栈 */
  stack: string[];
  pushModal: (id: string) => void;
  removeModal: (id: string) => void;
  isTopModal: (id: string) => boolean;
  topModalId: () => string | null;
  reset: () => void;
}

/**
 * 全局模态栈 Store（Wave 0 U5 底座）。
 * 负责统一仲裁 Escape 键归属：无论弹窗来自 Radix Dialog 还是自定义 `z-modal` 遮罩，
 * 只有位于栈顶的模态可以响应 Escape，避免嵌套弹框时误关闭底层设置窗口。
 */
export const useModalStackStore = create<ModalStackState>((set, get) => ({
  stack: [],

  pushModal: (id) =>
    set((state) => {
      if (!id) return state;
      if (state.stack[state.stack.length - 1] === id) return state;
      const filtered = state.stack.filter((entry) => entry !== id);
      return { stack: [...filtered, id] };
    }),

  removeModal: (id) =>
    set((state) => {
      if (!id || !state.stack.includes(id)) return state;
      return { stack: state.stack.filter((entry) => entry !== id) };
    }),

  isTopModal: (id) => {
    const { stack } = get();
    return stack.length > 0 && stack[stack.length - 1] === id;
  },

  topModalId: () => {
    const { stack } = get();
    return stack.length > 0 ? stack[stack.length - 1] : null;
  },

  reset: () => set({ stack: [] }),
}));
