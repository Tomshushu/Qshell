import React, { useState, useRef, useEffect } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  ShieldAlert,
  Check,
  Grid3X3,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { useAppStore } from "@/store";
import {
  hashAppLockPassword,
  verifyAppLockPassword,
  patternToKey,
  MIN_PATTERN_POINTS,
  type AppLockType,
} from "@/lib/app-lock";
import { PatternLock } from "@/components/ui/pattern-lock";
import { playSound, SoundType } from "@/lib/sound";
import { useToast } from "@/components/ui/toast";

export type AppLockDialogMode = "setup" | "change" | "disable";

export interface AppLockSetupDialogProps {
  open: boolean;
  mode?: AppLockDialogMode;
  /** 是否在初次设置完成后立即执行锁定 */
  lockImmediatelyOnSetup?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AppLockSetupDialog({
  open,
  mode = "setup",
  lockImmediatelyOnSetup = false,
  onClose,
  onSuccess,
}: AppLockSetupDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { appLockPasswordHash, appLockType, setAppLock, lockApp } = useAppStore();

  // 锁类型选择：密码 或 九点图案
  const [selectedType, setSelectedType] = useState<AppLockType>("password");

  // 密码模式状态
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 图案锁模式状态（设置与二次确认）
  const [patternStep, setPatternStep] = useState<1 | 2>(1);
  const [firstPattern, setFirstPattern] = useState<number[] | null>(null);
  const [confirmedPattern, setConfirmedPattern] = useState<number[] | null>(null);
  const [patternStatus, setPatternStatus] = useState<"normal" | "error" | "success">("normal");
  const [patternResetKey, setPatternResetKey] = useState(0);

  // 原图案验证状态（在关闭或修改且原为图案锁时使用）
  const [oldPatternVerified, setOldPatternVerified] = useState(false);
  const [oldPatternStatus, setOldPatternStatus] = useState<"normal" | "error" | "success">("normal");
  const [oldPatternResetKey, setOldPatternResetKey] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // 实时校验：输入确认密码时即刻判断是否与新密码一致
  const isMatch = Boolean(
    newPassword && confirmPassword && newPassword === confirmPassword,
  );
  const isMismatch = Boolean(
    confirmPassword &&
      (confirmTouched || confirmPassword.length >= newPassword.length
        ? confirmPassword !== newPassword
        : !newPassword.startsWith(confirmPassword)),
  );

  useEffect(() => {
    if (open) {
      setSelectedType(appLockType || "password");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setConfirmTouched(false);
      setShowOldPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);

      setPatternStep(1);
      setFirstPattern(null);
      setConfirmedPattern(null);
      setPatternStatus("normal");
      setPatternResetKey((k) => k + 1);

      setOldPatternVerified(false);
      setOldPatternStatus("normal");
      setOldPatternResetKey((k) => k + 1);

      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open, mode, appLockType]);

  // 验证原图案（关闭或修改原图案锁时调用）
  const handleVerifyOldPattern = async (pattern: number[]) => {
    setError(null);
    const key = patternToKey(pattern);
    const isValid = await verifyAppLockPassword(key, appLockPasswordHash);
    if (isValid) {
      setOldPatternStatus("success");
      playSound(SoundType.Complete);
      if (mode === "disable") {
        setAppLock(false, null);
        toast.success(t("app_lock_disabled_toast") || "应用锁已关闭");
        onSuccess?.();
        onClose();
      } else {
        // 修改模式：验证通过，展开新密码/新图案设置
        setOldPatternVerified(true);
        setOldPatternStatus("normal");
      }
    } else {
      playSound(SoundType.Error);
      setOldPatternStatus("error");
      setError(t("app_lock_pattern_wrong") || "图案错误，请重试");
      setTimeout(() => {
        setOldPatternStatus("normal");
        setOldPatternResetKey((k) => k + 1);
      }, 600);
    }
  };

  // 处理图案锁录入与确认流程
  const handlePatternComplete = (pattern: number[]) => {
    setError(null);
    if (patternStep === 1) {
      if (pattern.length < MIN_PATTERN_POINTS) {
        playSound(SoundType.Error);
        setPatternStatus("error");
        setError(t("app_lock_pattern_too_short") || "至少需要连接 4 个点");
        setTimeout(() => {
          setPatternStatus("normal");
          setPatternResetKey((k) => k + 1);
        }, 600);
        return;
      }
      // 步骤 1 绘制成功
      playSound(SoundType.Toggle);
      setFirstPattern(pattern);
      setPatternStep(2);
      setPatternStatus("normal");
      setPatternResetKey((k) => k + 1);
    } else {
      // 步骤 2 确认绘制
      const isSame =
        firstPattern &&
        firstPattern.length === pattern.length &&
        firstPattern.every((p, idx) => p === pattern[idx]);

      if (isSame) {
        playSound(SoundType.Complete);
        setPatternStatus("success");
        setConfirmedPattern(pattern);
      } else {
        playSound(SoundType.Error);
        setPatternStatus("error");
        setError(t("app_lock_pattern_mismatch") || "两次绘制的图案不一致，请重试");
        setTimeout(() => {
          setPatternStatus("normal");
          setPatternResetKey((k) => k + 1);
        }, 700);
      }
    }
  };

  const handleRedrawPattern = () => {
    playSound(SoundType.Click);
    setPatternStep(1);
    setFirstPattern(null);
    setConfirmedPattern(null);
    setPatternStatus("normal");
    setPatternResetKey((k) => k + 1);
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    setError(null);

    // 1. 关闭模式
    if (mode === "disable") {
      if (appLockType === "pattern") {
        // 图案锁在绘制原图案时已触发自动关闭
        return;
      }
      if (!oldPassword.trim()) {
        setError(t("app_lock_err_current_required") || "请输入当前密码以验证身份");
        return;
      }
      setSubmitting(true);
      try {
        const isValid = await verifyAppLockPassword(oldPassword, appLockPasswordHash);
        if (!isValid) {
          setError(t("app_lock_err_old_wrong") || "当前密码错误");
          setSubmitting(false);
          return;
        }
        setAppLock(false, null);
        toast.success(t("app_lock_disabled_toast") || "应用锁已关闭");
        onSuccess?.();
        onClose();
      } catch {
        setError(t("common_error") || "操作失败，请重试");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // 2. 修改模式下校验原身份（若原锁为密码）
    if (mode === "change" && appLockType === "password") {
      if (!oldPassword.trim()) {
        setError(t("app_lock_err_current_required") || "请输入当前密码以验证身份");
        return;
      }
      const isValid = await verifyAppLockPassword(oldPassword, appLockPasswordHash);
      if (!isValid) {
        setError(t("app_lock_err_old_wrong") || "当前密码错误");
        return;
      }
    }

    // 3. 图案锁保存
    if (selectedType === "pattern") {
      if (!confirmedPattern) {
        setError(t("app_lock_pattern_draw") || "请绘制解锁图案");
        return;
      }
      setSubmitting(true);
      try {
        const key = patternToKey(confirmedPattern);
        const hash = await hashAppLockPassword(key);
        setAppLock(true, hash, "pattern");
        toast.success(
          mode === "change"
            ? t("app_lock_pattern_changed_toast") || "九点图案锁已成功修改"
            : t("app_lock_pattern_enabled_toast") || "九点图案锁已成功启用",
        );
        onSuccess?.();
        onClose();
        if (lockImmediatelyOnSetup) {
          setTimeout(() => lockApp(), 100);
        }
      } catch {
        setError(t("common_error") || "保存失败，请重试");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // 4. 密码锁保存
    if (!newPassword.trim()) {
      setError(t("app_lock_err_new_required") || "请输入新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("app_lock_err_mismatch") || "两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      const newHash = await hashAppLockPassword(newPassword);
      setAppLock(true, newHash, "password");
      toast.success(
        mode === "change"
          ? t("app_lock_changed_toast") || "应用锁密码已成功修改"
          : t("app_lock_enabled_toast") || "应用锁已成功启用",
      );
      onSuccess?.();
      onClose();
      if (lockImmediatelyOnSetup) {
        setTimeout(() => lockApp(), 100);
      }
    } catch {
      setError(t("common_error") || "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const getTitle = () => {
    if (mode === "disable") return t("app_lock_disable_title") || "关闭应用锁";
    if (mode === "change") {
      return selectedType === "pattern"
        ? t("app_lock_change_pattern_btn") || "修改九点图案锁"
        : t("app_lock_change_title") || "修改应用锁密码";
    }
    return t("app_lock_setup_title") || "设置应用锁";
  };

  const getDescription = () => {
    if (mode === "disable") {
      return (
        t("app_lock_disable_desc") ||
        "请输入当前应用锁密码以验证操作权限，关闭后将不再对界面进行离席锁定。"
      );
    }
    if (mode === "change") {
      return (
        t("app_lock_change_desc") ||
        "输入原密码验证后设置新的应用锁密码或 PIN 码。"
      );
    }
    return (
      t("app_lock_setup_desc") ||
      "设置应用锁后，离开工位可一键锁定整个客户端，防止他人误触或窥视，后台所有 SSH 会话与任务持续运行。"
    );
  };

  // 是否需要先验证原图案锁（在 change 或 disable 模式下）
  const needsVerifyOldPattern =
    (mode === "disable" || (mode === "change" && !oldPatternVerified)) &&
    appLockType === "pattern";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "p-6 gap-0 transition-all",
          selectedType === "pattern" || needsVerifyOldPattern
            ? "sm:max-w-[390px]"
            : "sm:max-w-[360px]",
        )}
      >
        <form onSubmit={handleSubmit}>
          {/* 居中极简头部徽标 */}
          <div className="flex flex-col items-center text-center">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl mb-3 shadow-xs ring-1 ${
                mode === "disable"
                  ? "bg-destructive/10 text-destructive ring-destructive/20"
                  : mode === "change"
                    ? "bg-amber-500/10 text-amber-500 ring-amber-500/20"
                    : "bg-primary/10 text-primary ring-primary/20"
              }`}
            >
              {mode === "disable" ? (
                <ShieldAlert className="h-6 w-6" />
              ) : selectedType === "pattern" ? (
                <Grid3X3 className="h-6 w-6" />
              ) : mode === "change" ? (
                <KeyRound className="h-6 w-6" />
              ) : (
                <Lock className="h-6 w-6" />
              )}
            </div>
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              {getTitle()}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {getDescription()}
            </DialogDescription>
          </div>

          {/* 若原锁是图案锁，需要先验证当前原图案 */}
          {needsVerifyOldPattern ? (
            <div className="flex flex-col items-center py-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {t("app_lock_pattern_verify_current") || "请绘制当前图案以验证身份"}
              </p>
              <PatternLock
                size={220}
                onComplete={handleVerifyOldPattern}
                status={oldPatternStatus}
                resetKey={oldPatternResetKey}
              />
              {error && (
                <p className="text-xs font-medium text-destructive animate-in fade-in duration-150 mt-2 text-center">
                  {error}
                </p>
              )}
              <div className="w-full mt-4 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={onClose}
                >
                  {t("common_cancel") || "取消"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* 类型选择分段选项卡（在设置或修改模式下） */}
              {mode !== "disable" && (
                <div className="flex items-center justify-center mt-4">
                  <div className="inline-flex items-center rounded-lg bg-muted/60 p-0.5 border border-border/40">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedType("password");
                        setError(null);
                        playSound(SoundType.Click);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                        selectedType === "password"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Lock className="h-3 w-3" />
                      <span>{t("app_lock_type_password") || "密码 / PIN"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedType("pattern");
                        setError(null);
                        playSound(SoundType.Click);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                        selectedType === "pattern"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Grid3X3 className="h-3 w-3" />
                      <span>{t("app_lock_type_pattern") || "九点图案锁"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 表单区域 */}
              <div className="space-y-3 py-4">
                {/* 修改模式且原锁是密码时，需验证当前密码 */}
                {mode === "change" && appLockType === "password" && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block text-left">
                      {t("app_lock_old_pwd_label") || "当前密码"}
                    </label>
                    <div className="relative">
                      <Input
                        ref={inputRef}
                        type={showOldPassword ? "text" : "password"}
                        placeholder={
                          t("app_lock_old_pwd_placeholder") || "输入当前正在使用的密码"
                        }
                        value={oldPassword}
                        onChange={(e) => {
                          setOldPassword(e.target.value);
                          if (error) setError(null);
                        }}
                        className="h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors"
                        autoFocus
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                        onClick={() => setShowOldPassword((v) => !v)}
                      >
                        {showOldPassword ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 关闭模式且原锁是密码 */}
                {mode === "disable" && appLockType === "password" && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block text-left">
                      {t("app_lock_old_pwd_label") || "当前密码"}
                    </label>
                    <div className="relative">
                      <Input
                        ref={inputRef}
                        type={showOldPassword ? "text" : "password"}
                        placeholder={
                          t("app_lock_old_pwd_placeholder") || "输入当前正在使用的密码"
                        }
                        value={oldPassword}
                        onChange={(e) => {
                          setOldPassword(e.target.value);
                          if (error) setError(null);
                        }}
                        className="h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors"
                        autoFocus
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                        onClick={() => setShowOldPassword((v) => !v)}
                      >
                        {showOldPassword ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* 选项 A：九点图案锁绘制区 */}
                {mode !== "disable" && selectedType === "pattern" && (
                  <div className="flex flex-col items-center pt-1">
                    <div className="flex items-center justify-between w-full px-2 mb-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {patternStep === 1
                          ? t("app_lock_pattern_draw") || "请绘制解锁图案（至少 4 个点）"
                          : t("app_lock_pattern_draw_confirm") || "请再次绘制图案以确认"}
                      </span>
                      {patternStep === 2 && (
                        <button
                          type="button"
                          onClick={handleRedrawPattern}
                          className="flex items-center gap-1 text-[11px] text-primary hover:underline underline-offset-2"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>{t("app_lock_pattern_redraw") || "重新绘制"}</span>
                        </button>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-2 shadow-inner">
                      <PatternLock
                        size={220}
                        onComplete={handlePatternComplete}
                        status={patternStatus}
                        resetKey={patternResetKey}
                      />
                    </div>

                    {confirmedPattern && (
                      <p className="text-[11px] font-medium text-emerald-500 flex items-center gap-1 mt-2 animate-in fade-in duration-150">
                        <Check className="h-3 w-3" />
                        <span>{t("app_lock_pattern_matched") || "图案一致"}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* 选项 B：密码输入区 */}
                {mode !== "disable" && selectedType === "password" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground block text-left">
                        {mode === "change"
                          ? t("app_lock_new_pwd_label") || "新密码 / PIN"
                          : t("app_lock_pwd_label") || "解锁密码 / PIN"}
                      </label>
                      <div className="relative">
                        <Input
                          ref={mode === "setup" ? inputRef : undefined}
                          type={showNewPassword ? "text" : "password"}
                          placeholder={
                            t("app_lock_pwd_placeholder") || "设置应用锁密码"
                          }
                          value={newPassword}
                          onChange={(e) => {
                            setNewPassword(e.target.value);
                            if (error) setError(null);
                          }}
                          className="h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors"
                          autoFocus={mode === "setup"}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                          onClick={() => setShowNewPassword((v) => !v)}
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground block text-left">
                        {t("app_lock_pwd_confirm") || "再次确认密码"}
                      </label>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder={
                            mode === "setup"
                              ? t("app_lock_pwd_confirm_placeholder") || "再次输入上方密码"
                              : t("app_lock_new_pwd_confirm_ph") || "再次输入新密码"
                          }
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (error) setError(null);
                          }}
                          onBlur={() => setConfirmTouched(true)}
                          className={cn(
                            "h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors",
                            isMatch &&
                              "border-emerald-500/80 ring-1 ring-emerald-500/30 focus-visible:ring-emerald-500/50",
                            isMismatch &&
                              "border-destructive ring-1 ring-destructive focus-visible:ring-destructive",
                          )}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {isMatch && (
                        <p className="text-[11px] font-medium text-emerald-500 flex items-center gap-1 mt-1 animate-in fade-in duration-150 text-left">
                          <Check className="h-3 w-3" />
                          <span>{t("app_lock_pwd_matched") || "密码一致"}</span>
                        </p>
                      )}
                      {isMismatch && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1 mt-1 animate-in fade-in duration-150 text-left">
                          <span>{t("app_lock_err_mismatch") || "两次输入的密码不一致"}</span>
                        </p>
                      )}
                    </div>
                  </>
                )}

                {error && (!isMismatch || error !== (t("app_lock_err_mismatch") || "两次输入的密码不一致")) && (
                  <p className="text-xs font-medium text-destructive animate-in fade-in duration-150 text-center">
                    {error}
                  </p>
                )}
              </div>

              {/* 底部操作按钮 */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 rounded-lg text-xs"
                  onClick={onClose}
                  disabled={submitting}
                >
                  {t("common_cancel") || "取消"}
                </Button>
                <Button
                  type="submit"
                  variant={mode === "disable" ? "destructive" : "default"}
                  size="sm"
                  className="flex-1 h-9 rounded-lg text-xs shadow-xs"
                  disabled={
                    submitting ||
                    (mode !== "disable" &&
                      (selectedType === "pattern"
                        ? !confirmedPattern
                        : !newPassword.trim() || !confirmPassword.trim() || isMismatch))
                  }
                >
                  {mode === "disable"
                    ? t("app_lock_confirm_disable_btn") || "确认关闭"
                    : lockImmediatelyOnSetup
                      ? t("app_lock_confirm_and_lock_btn") || "保存并锁定"
                      : t("common_save") || "保存"}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
