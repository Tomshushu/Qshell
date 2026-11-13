import { create } from "zustand";
import { Z_LAYER } from "@/lib/z-layer";

/**
 * 可交互浮窗（窗口型 UI）的动态层级栈，模拟 Windows 窗口：
 * - 区间 60~99（Z_LAYER.WINDOW_BASE~WINDOW_MAX）：仅在「窗口层」内部排序，
 *   永远低于模态层 200~299，因此点击置顶不会盖住新打开的模态弹框。
 * - 新打开的窗口自动置顶；点击任意窗口可再次置顶
 * - 区间用尽时按当前顺序紧凑重排，保持窗口之间的相对层级不变
 */
export const WINDOW_Z_BASE = Z_LAYER.WINDOW_BASE;
export const WINDOW_Z_MAX = Z_LAYER.WINDOW_MAX;

interface WindowLayerState {
  layers: Record<string, number>;
  topZ: number;
  register: (id: string) => void;
  unregister: (id: string) => void;
  bringToFront: (id: string) => void;
}

function allocate(
  state: Pick<WindowLayerState, "layers" | "topZ">,
  id: string,
): Pick<WindowLayerState, "layers" | "topZ"> {
  if (state.layers[id] === state.topZ && state.topZ >= WINDOW_Z_BASE) {
    return state;
  }

  let layers = { ...state.layers };
  let next = state.topZ + 1;

  if (next > WINDOW_Z_MAX) {
    const ordered = Object.keys(layers).sort((a, b) => layers[a] - layers[b]);
    layers = {};
    ordered.forEach((key, idx) => {
      layers[key] = WINDOW_Z_BASE + idx;
    });
    next = WINDOW_Z_BASE + ordered.length;
  }

  layers[id] = next;
  return { layers, topZ: next };
}

export const useWindowLayerStore = create<WindowLayerState>((set) => ({
  layers: {},
  topZ: WINDOW_Z_BASE - 1,

  // 打开时注册即置顶（重复注册同样会提到最上层）
  register: (id) => set((state) => allocate(state, id)),

  unregister: (id) =>
    set((state) => {
      if (!(id in state.layers)) return state;
      const layers = { ...state.layers };
      delete layers[id];
      return { layers };
    }),

  bringToFront: (id) => set((state) => allocate(state, id)),
}));
