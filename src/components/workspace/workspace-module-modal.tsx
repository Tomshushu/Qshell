import React, { useState, useEffect } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WorkspaceModuleModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  extraHeaderActions?: React.ReactNode;
  keepMounted?: boolean;
}

export function WorkspaceModuleModal({
  open,
  onClose,
  title,
  icon,
  children,
  extraHeaderActions,
  keepMounted = true,
}: WorkspaceModuleModalProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => {
    if (open) {
      setHasOpened(true);
    } else if (hasOpened) {
      // 模块弹窗关闭时，自动通知恢复终端输入光标焦点
      window.dispatchEvent(new CustomEvent("focus-active-terminal"));
    }
  }, [open, hasOpened]);

  // 监听 ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isMaximized) {
          setIsMaximized(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isMaximized, onClose]);

  // 如果从未打开过且无需渲染，则提前返回
  if (!open && (!keepMounted || !hasOpened)) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5",
        !open && "hidden pointer-events-none"
      )}
      aria-hidden={!open}
    >
      {/* 半透明毛玻璃遮罩背景，点击外部关闭 */}
      <div
        className="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-150"
        onClick={onClose}
      />

      {/* 弹框主体 */}
      <div
        className={cn(
          "relative z-10 flex flex-col bg-background/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl overflow-hidden transition-all duration-200 animate-in fade-in-0 zoom-in-95",
          isMaximized
            ? "w-[calc(100vw-16px)] h-[calc(100vh-16px)] rounded-xl"
            : "w-[88vw] max-w-6xl h-[82vh] max-h-[920px]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40 select-none h-11 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-primary shrink-0">{icon}</span>}
            <span className="font-semibold text-sm text-foreground truncate">
              {title}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {extraHeaderActions}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              onClick={() => setIsMaximized((prev) => !prev)}
              title={isMaximized ? "还原窗口" : "最大化窗口"}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
              onClick={onClose}
              title="关闭 (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 弹框内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {children}
        </div>
      </div>
    </div>
  );
}
