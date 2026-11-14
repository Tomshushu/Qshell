import { useEffect, useId, useRef } from "react";
import { useModalStackStore } from "@/store/modal-stack-store";

/**
 * 将任意弹窗/遮罩层登记进全局模态栈，并在提供 `onEscape` 时仅允许栈顶实例消费 Escape。
 * 返回生成的唯一 `modalId`，可供 Radix `DialogContent` 在 `onEscapeKeyDown` 中校验是否位于栈顶。
 */
export function useModalStack(
  prefix: string,
  open: boolean,
  onEscape?: () => void,
): string {
  const reactId = useId();
  const modalId = `${prefix}:${reactId}`;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const pushModal = useModalStackStore((s) => s.pushModal);
  const removeModal = useModalStackStore((s) => s.removeModal);

  useEffect(() => {
    if (!open) return;
    pushModal(modalId);
    return () => {
      removeModal(modalId);
    };
  }, [open, modalId, pushModal, removeModal]);

  useEffect(() => {
    if (!open || !onEscapeRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!useModalStackStore.getState().isTopModal(modalId)) return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current?.();
    };

    // 捕获阶段优先拦截：确保手写遮罩位于 Radix Dialog 之上时，先由顶层遮罩消费 Escape
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, modalId, Boolean(onEscape)]);

  return modalId;
}
