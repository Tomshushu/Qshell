import { useState, useRef, useEffect, useCallback } from "react";
import { Lock, Unlock, ShieldAlert, Eye, EyeOff, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PatternLock } from "@/components/ui/pattern-lock";
import { verifyAppLockPassword, patternToKey } from "@/lib/app-lock";
import { playSound, SoundType } from "@/lib/sound";
import { useAppStore } from "@/store";
import type { LockedTerminalEntry } from "@/store/terminal-lock-store";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";

interface TerminalLockOverlayProps {
  entry: LockedTerminalEntry;
  sessionTitle?: string;
  onUnlock: (termId: string) => void;
}

/**
 * 局部终端交互锁遮罩层：
 * - 仅遮蔽当前终端窗格的鼠标与键盘交互，后台通道读写与录屏/触发器照常运行；
 * - 完全复用全局应用锁的密码/PIN 与九点图案两套认证配置，取消独立临时 PIN，保持体验与安全性统一。
 */
export function TerminalLockOverlay({
  entry,
  sessionTitle,
  onUnlock,
}: TerminalLockOverlayProps) {
  const { t } = useTranslation();
  const appLockEnabled = useAppStore((s) => s.appLockEnabled);
  const appLockType = useAppStore((s) => s.appLockType);
  const appLockPasswordHash = useAppStore((s) => s.appLockPasswordHash);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [shake, setShake] = useState(false);
  const [patternStatus, setPatternStatus] = useState<"normal" | "error" | "success">("normal");
  const [patternResetKey, setPatternResetKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const verifySeqRef = useRef(0);

  const hasAppLock = Boolean(appLockEnabled && appLockPasswordHash);
  const isPattern = hasAppLock && appLockType === "pattern";

  useEffect(() => {
    setPassword("");
    setShowPassword(false);
    setErrorMsg(null);
    setShake(false);
    setPatternStatus("normal");
    setPatternResetKey((k) => k + 1);
    if (hasAppLock && !isPattern) {
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => window.clearTimeout(timer);
    }
  }, [hasAppLock, isPattern, entry.termId, appLockPasswordHash]);

  const finishUnlock = useCallback(() => {
    setErrorMsg(null);
    setPassword("");
    onUnlock(entry.termId);
    window.dispatchEvent(new CustomEvent("focus-active-terminal"));
  }, [entry.termId, onUnlock]);

  // 与全局应用锁一致：逐字输入完整且正确时自动解锁
  const checkAutoUnlock = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || !appLockPasswordHash) return;
      const seq = ++verifySeqRef.current;
      try {
        const valid = await verifyAppLockPassword(trimmed, appLockPasswordHash);
        if (seq !== verifySeqRef.current) return;
        if (valid) {
          finishUnlock();
        }
      } catch {
        // 忽略后台输入过程中的异常
      }
    },
    [appLockPasswordHash, finishUnlock],
  );

  const handleSubmitUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!hasAppLock || !appLockPasswordHash) {
      finishUnlock();
      return;
    }
    const trimmed = password.trim();
    if (!trimmed) {
      setErrorMsg(t("lock_password_required") || "请输入解锁密码");
      return;
    }
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorMsg(null);
    try {
      const valid = await verifyAppLockPassword(trimmed, appLockPasswordHash);
      if (valid) {
        finishUnlock();
      } else {
        playSound(SoundType.Error);
        setErrorMsg(t("lock_wrong_password") || "密码错误，请重试");
        setShake(true);
        setPassword("");
        window.setTimeout(() => setShake(false), 500);
        inputRef.current?.focus();
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePatternUnlock = async (pattern: number[]) => {
    if (!appLockPasswordHash || isVerifying) return;
    setIsVerifying(true);
    try {
      const key = patternToKey(pattern);
      const valid = await verifyAppLockPassword(key, appLockPasswordHash);
      if (valid) {
        setPatternStatus("success");
        playSound(SoundType.Complete);
        finishUnlock();
      } else {
        playSound(SoundType.Error);
        setErrorMsg(t("app_lock_pattern_wrong") || "图案错误，请重试");
        setShake(true);
        setPatternStatus("error");
        window.setTimeout(() => setShake(false), 500);
        window.setTimeout(() => {
          setPatternStatus("normal");
          setPatternResetKey((k) => k + 1);
        }, 650);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      data-testid={`terminal-lock-overlay-${entry.termId}`}
      data-terminal-lock-overlay="true"
      role="dialog"
      aria-modal="true"
      className="terminal-lock-overlay absolute inset-0 z-[150] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 select-none"
      onClick={() => {
        if (hasAppLock && !isPattern) {
          inputRef.current?.focus();
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        // 阻止按键或快捷键透传到底层终端及外层全局快捷键
        if (e.ctrlKey || e.metaKey || e.altKey) {
          e.preventDefault();
        }
        e.stopPropagation();
      }}
    >
      <div
        className={cn(
          "w-full rounded-2xl border border-border/70 bg-card/95 p-5 shadow-2xl text-center space-y-3.5 transition-transform",
          isPattern ? "max-w-[300px]" : "max-w-xs",
          shake && "animate-shake",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30">
          {isPattern ? <Grid3X3 className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            {t("tm_lock_overlay_title") || "当前工作台已锁定"}
          </h3>
          {sessionTitle && (
            <p className="text-xs font-mono text-muted-foreground truncate">
              {sessionTitle}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            {isPattern
              ? t("tm_lock_pattern_subtitle") || "绘制应用锁图案以解锁当前工作台"
              : t("tm_lock_overlay_desc") ||
                "当前工作台的终端、文件与管理操作已隔离，后台连接与输出保持运行；其他工作台不受影响。"}
          </p>
        </div>

        {!hasAppLock ? (
          <div className="space-y-2.5">
            <p className="text-[11px] leading-relaxed text-amber-500/90 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
              {t("tm_lock_app_disabled_hint") || "应用锁已关闭，点击可直接解锁"}
            </p>
            <Button
              type="button"
              size="sm"
              className="w-full h-8 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-slate-950"
              onClick={finishUnlock}
            >
              <Unlock className="h-3.5 w-3.5 mr-1.5" />
              {t("tm_lock_unlock_btn") || "解锁此终端"}
            </Button>
          </div>
        ) : isPattern ? (
          <div className="flex flex-col items-center space-y-2">
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-1.5 shadow-inner">
              <PatternLock
                size={200}
                status={patternStatus}
                resetKey={patternResetKey}
                onStart={() => {
                  if (errorMsg) setErrorMsg(null);
                }}
                onComplete={handlePatternUnlock}
                disabled={isVerifying}
              />
            </div>
            {errorMsg && (
              <div className="flex items-center justify-center gap-1 text-[11px] text-destructive">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmitUnlock} className="space-y-2.5">
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  const val = e.target.value;
                  setPassword(val);
                  if (errorMsg) setErrorMsg(null);
                  void checkAutoUnlock(val);
                }}
                placeholder={t("tm_lock_enter_app_pwd") || "输入应用锁密码解锁"}
                className={cn(
                  "h-9 w-full rounded-lg border bg-background pl-3 pr-8 text-xs font-mono outline-none transition-colors focus:ring-2 focus:ring-amber-500/40",
                  errorMsg ? "border-destructive" : "border-border/70",
                )}
                autoComplete="off"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t("common_hide") || "隐藏" : t("common_show") || "显示"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {errorMsg && (
              <div className="flex items-center justify-center gap-1 text-[11px] text-destructive">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={isVerifying}
              className="w-full h-8 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-slate-950"
            >
              <Unlock className="h-3.5 w-3.5 mr-1.5" />
              {t("tm_lock_unlock_btn") || "解锁此终端"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
