import { useEffect, useId, useRef } from "react";
import { useModalStackStore } from "@/store/modal-stack-store";

/** 标记一次 Escape 仅被「非栈顶的底层 Radix 对话框」阻止，而不是被真正消费。 */
export interface ModalStackEscapeEvent extends KeyboardEvent {
  __qshellLowerLayerBlocked?: boolean;
}

/**
 * 是否存在会自行处理 Escape 的 Radix 层：
 * - Popover / Select / DropdownMenu 的 Content 经 Popper Portal 渲染，带 wrapper；
 * - Radix Dialog / AlertDialog 的 Content 带 role=dialog + data-state=open。
 * 只有这类层存在时才需要延后仲裁，让 Radix 先关最内层浮层。
 */
function hasRadixEscapeConsumer(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector("[data-radix-popper-content-wrapper]") !== null ||
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
    ) !== null
  );
}

/**
 * 将任意弹窗/遮罩层登记进全局模态栈，并在提供 `onEscape` 时仅允许栈顶实例消费 Escape。
 * 返回生成的唯一 `modalId`，可供 Radix `DialogContent` 在 `onEscapeKeyDown` 中校验是否位于栈顶。
 *
 * Escape 仲裁原则：Radix 的 DismissableLayer 在 document 捕获阶段监听 keydown，
 * 会优先关闭表单内部展开的 Popover / Select。因此这里绝不能在 window 捕获阶段
 * `stopPropagation()`（那会让 Radix 完全收不到事件，按一次 Esc 直接关掉整个表单并丢草稿），
 * 而是等本轮事件分发结束后，若没有任何更内层的 Radix 浮层消费该事件，才由栈顶模态响应。
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
    let disposed = false;

    const handleKeyDown = (event: ModalStackEscapeEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!useModalStackStore.getState().isTopModal(modalId)) return;

      // 纯自定义遮罩（无 Radix 弹层）没有竞争方，保持同步关闭，
      // 避免把常见的 Esc 关闭行为推迟到微任务而破坏既有交互与测试。
      if (!hasRadixEscapeConsumer()) {
        onEscapeRef.current?.();
        return;
      }

      // 表单内嵌的 Popover / Select 打开时，Radix DismissableLayer 会在
      // document 捕获阶段消费 Escape 并关闭下拉。此时不能抢先关掉整个表单，
      // 等本轮事件分发结束后再按 defaultPrevented 判断是否已被消费。
      queueMicrotask(() => {
        if (disposed) return;
        const consumedByRadix =
          event.defaultPrevented && !event.__qshellLowerLayerBlocked;
        if (consumedByRadix) return;
        // 微任务期间栈可能已变化（例如 Radix 已关闭了某个弹层），重新确认栈顶
        if (!useModalStackStore.getState().isTopModal(modalId)) return;
        onEscapeRef.current?.();
      });
    };

    window.addEventListener("keydown", handleKeyDown as EventListener, true);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", handleKeyDown as EventListener, true);
    };
  }, [open, modalId, Boolean(onEscape)]);

  return modalId;
}
