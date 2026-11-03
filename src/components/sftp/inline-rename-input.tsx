import { useEffect, useRef } from "react";

// 内联重命名输入框：直接在文件行上就地编辑文件名，支持智能选中文件名（不含扩展名）、全主题高对比度防穿透与失焦自动保存
export function InlineRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef(value);
  const isHandledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 智能选中主文件名（若包含扩展名如 foo.tar.gz / app.jar，默认仅高亮主文件名，方便直接输入新名称）
    const dotIdx = value.lastIndexOf(".");
    if (dotIdx > 0) {
      el.setSelectionRange(0, dotIdx);
    } else {
      el.select();
    }
  }, []);

  const handleFinish = (isExplicitCancel = false) => {
    if (isHandledRef.current) return;
    isHandledRef.current = true;

    if (isExplicitCancel) {
      onCancel();
      return;
    }

    const currentValue = inputRef.current?.value ?? value;
    const trimmed = currentValue.trim();
    const initial = initialValueRef.current.trim();

    // 若名称未做改动或为空，直接取消/关闭，不发起重命名调用
    if (!trimmed || trimmed === initial) {
      onCancel();
    } else {
      // 若当前输入值与 state 尚未同步，先同步再提交
      if (currentValue !== value) {
        onChange(currentValue);
      }
      onCommit();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          handleFinish(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          handleFinish(true);
        }
      }}
      onBlur={() => {
        handleFinish(false);
      }}
      style={{
        color: "var(--color-foreground)",
        backgroundColor: "var(--color-background)",
      }}
      className="min-w-0 flex-1 rounded-sm border border-primary bg-background px-1.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-primary shadow-xs"
    />
  );
}
