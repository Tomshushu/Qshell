import { useCallback, useEffect } from "react";
import { useWindowLayerStore, WINDOW_Z_BASE } from "@/store/window-layer-store";

/**
 * 把「窗口型浮层」接入全局层级栈：
 * - active 变 true（打开）时自动置顶
 * - 调用 activate（挂在窗口根的 onPointerDownCapture）时再次置顶
 * - 关闭 / 卸载时注销
 *
 * 返回可直接写入 style 的 zIndex 与点击回调。
 */
export function useWindowLayer(id: string, active: boolean) {
  const zIndex = useWindowLayerStore((s) => s.layers[id] ?? WINDOW_Z_BASE);
  const register = useWindowLayerStore((s) => s.register);
  const unregister = useWindowLayerStore((s) => s.unregister);
  const bringToFront = useWindowLayerStore((s) => s.bringToFront);

  useEffect(() => {
    if (active) {
      register(id);
    } else {
      unregister(id);
    }
    return () => unregister(id);
  }, [active, id, register, unregister]);

  const activate = useCallback(() => {
    if (active) bringToFront(id);
  }, [active, id, bringToFront]);

  return { zIndex, activate };
}
