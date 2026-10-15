import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle,
  Grid3X3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAppStore } from "@/store";
import { useTranslation } from "@/i18n";
import { verifyAppLockPassword, patternToKey } from "@/lib/app-lock";
import { PatternLock } from "@/components/ui/pattern-lock";
import { playSound, SoundType } from "@/lib/sound";

export function AppLockOverlay() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const {
    isAppLocked,
    appLockType,
    appLockPasswordHash,
    unlockApp,
    closeAllTabs,
    setAppLock,
  } = useAppStore();

  const [inputVal, setInputVal] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [shake, setShake] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  // 图案锁状态
  const [patternStatus, setPatternStatus] = useState<"normal" | "error" | "success">(
    "normal",
  );
  const [patternResetKey, setPatternResetKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const verifySeqRef = useRef(0);

  useEffect(() => {
    if (isAppLocked) {
      setInputVal("");
      setError(false);
      setShake(false);
      setShowResetConfirm(false);
      setCapsLockOn(false);
      setPatternStatus("normal");
      setPatternResetKey((k) => k + 1);

      if (appLockType !== "pattern") {
        const timer = setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [isAppLocked, appLockType]);

  // 全局键盘事件隔离：锁定时阻止任何快捷键穿透到下层页面
  useEffect(() => {
    if (!isAppLocked) return;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      // 确认重置弹层激活时，允许按 Esc 退出重置确认
      if (showResetConfirm) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowResetConfirm(false);
        }
        return;
      }

      // 允许在密码输入框中打字和回车，但阻止其他任何组合键（Ctrl+W/T/K/Q 等）
      if (e.key === "Tab" && appLockType !== "pattern") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // 阻止如 Ctrl+T / Ctrl+W / Ctrl+K / Ctrl+Tab 等快捷键
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [isAppLocked, showResetConfirm, appLockType]);

  // 像 Windows 锁屏一样：逐字从前到后匹配，输入完整且正确时立即自动解锁
  const checkAutoUnlock = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || !appLockPasswordHash) return;

      const seq = ++verifySeqRef.current;
      try {
        const isValid = await verifyAppLockPassword(trimmed, appLockPasswordHash);
        if (seq !== verifySeqRef.current) return;
        if (isValid) {
          setError(false);
          unlockApp();
          window.dispatchEvent(new CustomEvent("focus-active-terminal"));
        }
      } catch {
        // 忽略逐字输入过程中的后台匹配异常
      }
    },
    [appLockPasswordHash, unlockApp],
  );

  const handleUnlock = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!inputVal.trim() || isVerifying) return;

      setIsVerifying(true);
      try {
        const isValid = await verifyAppLockPassword(inputVal, appLockPasswordHash);
        if (isValid) {
          setError(false);
          unlockApp();
          window.dispatchEvent(new CustomEvent("focus-active-terminal"));
        } else {
          playSound(SoundType.Error);
          setError(true);
          setShake(true);
          setInputVal("");
          setTimeout(() => setShake(false), 500);
          inputRef.current?.focus();
        }
      } catch {
        setError(true);
      } finally {
        setIsVerifying(false);
      }
    },
    [inputVal, isVerifying, appLockPasswordHash, unlockApp],
  );

  // 九点图案锁解锁验证
  const handlePatternUnlock = useCallback(
    async (pattern: number[]) => {
      if (!appLockPasswordHash || isVerifying) return;
      setIsVerifying(true);
      try {
        const key = patternToKey(pattern);
        const isValid = await verifyAppLockPassword(key, appLockPasswordHash);
        if (isValid) {
          setPatternStatus("success");
          playSound(SoundType.Complete);
          setError(false);
          unlockApp();
          window.dispatchEvent(new CustomEvent("focus-active-terminal"));
        } else {
          playSound(SoundType.Error);
          setError(true);
          setShake(true);
          setPatternStatus("error");
          setTimeout(() => setShake(false), 500);
          setTimeout(() => {
            setPatternStatus("normal");
            setPatternResetKey((k) => k + 1);
          }, 650);
        }
      } catch {
        setError(true);
      } finally {
        setIsVerifying(false);
      }
    },
    [appLockPasswordHash, isVerifying, unlockApp],
  );

  const handleResetAppLock = useCallback(() => {
    playSound(SoundType.Click);
    // 强制掐断并销毁所有 SSH/SFTP 活跃会话与标签页（含被锁定的 tab）
    closeAllTabs(true);
    // 清空应用锁设置与密码哈希
    setAppLock(false, null, "password");
    // 解除界面锁定状态
    unlockApp();
    setShowResetConfirm(false);
    toast.success(t("app_lock_reset_success_toast"));
  }, [closeAllTabs, setAppLock, unlockApp, t, toast]);

  if (!isAppLocked) return null;

  const isPattern = appLockType === "pattern";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        showResetConfirm
          ? t("app_lock_reset_confirm_title")
          : t("app_lock_overlay_title")
      }
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-background/80 backdrop-blur-2xl p-6 select-none animate-in fade-in duration-200"
      onClick={() => {
        if (!showResetConfirm && !isPattern) inputRef.current?.focus();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-2xl transition-transform ${
          isPattern ? "max-w-[360px]" : "max-w-[340px]"
        } ${shake ? "animate-shake" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {showResetConfirm ? (
          /* 忘记密码安全重置二次确认视图 */
          <div className="flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20 shadow-inner">
              <AlertTriangle className="h-6 w-6 animate-pulse" />
            </div>

            <h2 className="text-base font-semibold text-foreground tracking-tight">
              {t("app_lock_reset_confirm_title")}
            </h2>

            <div className="mt-2.5 rounded-xl border border-border/50 bg-muted/30 p-3 text-left">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("app_lock_reset_confirm_desc")}
              </p>
            </div>

            <div className="mt-5 flex w-full gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-9 rounded-lg text-xs"
                onClick={() => {
                  playSound(SoundType.Toggle);
                  setShowResetConfirm(false);
                }}
              >
                {t("app_lock_reset_cancel_btn")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 h-9 rounded-lg text-xs shadow-xs"
                onClick={handleResetAppLock}
              >
                {t("app_lock_reset_confirm_btn")}
              </Button>
            </div>
          </div>
        ) : isPattern ? (
          /* 九点图案锁解锁视图 */
          <div className="flex flex-col items-center text-center">
            {/* 呼吸光环图标 */}
            <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-inner">
              <Grid3X3 className="h-6 w-6 animate-pulse" />
            </div>

            <h2 className="text-base font-semibold text-foreground tracking-tight">
              {t("app_lock_overlay_title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {t("app_lock_pattern_overlay_subtitle")}
            </p>

            <div className="mt-4 rounded-2xl border border-border/60 bg-muted/20 p-2 shadow-inner">
              <PatternLock
                size={240}
                status={patternStatus}
                resetKey={patternResetKey}
                onStart={() => {
                  if (error) setError(false);
                }}
                onComplete={handlePatternUnlock}
                disabled={isVerifying}
              />
            </div>

            {error && (
              <p className="text-xs font-medium text-destructive animate-in fade-in duration-150 mt-2 text-center">
                {t("app_lock_pattern_wrong")}
              </p>
            )}

            {/* 忘记图案？安全重置 */}
            <div className="mt-3.5 flex flex-col items-center">
              <button
                type="button"
                onClick={() => {
                  playSound(SoundType.Warn);
                  setShowResetConfirm(true);
                }}
                className="text-[11px] text-muted-foreground/60 hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("app_lock_forgot_btn")}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/80 shrink-0" />
              <span>
                {t("app_lock_safe_tip")}
              </span>
            </div>
          </div>
        ) : (
          /* 标准密码输入解锁视图 */
          <form onSubmit={handleUnlock} className="flex flex-col items-center text-center">
            {/* 锁屏呼吸光环图标 */}
            <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20 shadow-inner">
              <Lock className="h-6 w-6 animate-pulse" />
            </div>

            <h2 className="text-base font-semibold text-foreground tracking-tight">
              {t("app_lock_overlay_title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {t("app_lock_overlay_subtitle")}
            </p>

            <div className="mt-5 w-full space-y-2">
              <div className="relative">
                <Input
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  placeholder={t("app_lock_overlay_input_ph")}
                  value={inputVal}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setInputVal(nextVal);
                    if (error) setError(false);
                    void checkAutoUnlock(nextVal);
                  }}
                  onKeyDown={(e) => {
                    setCapsLockOn(e.getModifierState("CapsLock"));
                  }}
                  onKeyUp={(e) => {
                    setCapsLockOn(e.getModifierState("CapsLock"));
                  }}
                  disabled={isVerifying}
                  className={`h-9.5 text-center text-xs pr-9 pl-9 bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors ${
                    error ? "border-destructive ring-1 ring-destructive" : ""
                  }`}
                  autoFocus
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? t("common_hide") : t("common_show")}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {capsLockOn && !error && (
                <p className="text-[11px] font-medium text-amber-500 animate-in fade-in duration-150">
                  {t("app_lock_caps_lock_on")}
                </p>
              )}

              {error && (
                <p className="text-xs font-medium text-destructive animate-in fade-in duration-150">
                  {t("app_lock_err_wrong")}
                </p>
              )}

              <Button
                type="submit"
                className="w-full gap-2 h-9 rounded-lg text-xs font-medium shadow-xs mt-1"
                variant="default"
                disabled={!inputVal || isVerifying}
              >
                <Unlock className="h-3.5 w-3.5" />
                <span>{t("app_lock_overlay_unlock_btn")}</span>
              </Button>
            </div>

            {/* 忘记密码？安全重置 */}
            <div className="mt-3.5 flex flex-col items-center">
              <button
                type="button"
                onClick={() => {
                  playSound(SoundType.Warn);
                  setShowResetConfirm(true);
                }}
                className="text-[11px] text-muted-foreground/60 hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("app_lock_forgot_btn")}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/80 shrink-0" />
              <span>
                {t("app_lock_safe_tip")}
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
