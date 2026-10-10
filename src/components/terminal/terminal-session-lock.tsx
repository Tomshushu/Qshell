import { useState, useRef, useEffect } from "react";
import { Lock, Unlock, Eye, EyeOff, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";

export interface TerminalLockDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmLock: (password: string) => void;
  serverName?: string;
}

export function TerminalLockDialog({
  open,
  onClose,
  onConfirmLock,
  serverName,
}: TerminalLockDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password.trim()) {
      setError(t("tm_lock_err_empty") || "请输入临时解锁密码");
      return;
    }
    if (confirmPassword && password !== confirmPassword) {
      setError(t("tm_lock_err_mismatch") || "两次输入的密码不一致");
      return;
    }
    onConfirmLock(password.trim());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[360px] p-6 gap-0">
        <form onSubmit={handleSubmit}>
          {/* 居中极简头部徽标 */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20 shadow-xs mb-3">
              <Lock className="h-6 w-6" />
            </div>
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              {t("tm_lock_dialog_title") || "锁定终端会话"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {t("tm_lock_dialog_desc") ||
                `锁定 ${serverName ? `[${serverName}]` : ""} 会话。离席期间防止他人误触键盘，远端程序保持后台运行。`}
            </DialogDescription>
          </div>

          <div className="space-y-3 py-5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block text-left">
                {t("tm_lock_pwd_label") || "临时解锁密码 / PIN"}
              </label>
              <div className="relative">
                <Input
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  placeholder={t("tm_lock_pwd_placeholder") || "设置本次锁屏的临时解锁密码"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors"
                  autoComplete="off"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-1 transition-colors"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block text-left">
                {t("tm_lock_pwd_confirm") || "再次确认密码 (可选)"}
              </label>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder={t("tm_lock_pwd_confirm_placeholder") || "留空则直接使用上方密码"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="h-9 pr-9 text-xs bg-muted/30 border-border/60 hover:border-border/80 focus-visible:bg-background rounded-lg transition-colors"
                  autoComplete="off"
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
            </div>

            {error && (
              <p className="text-xs font-medium text-destructive animate-in fade-in duration-150 text-center">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 h-9 rounded-lg text-xs"
              onClick={onClose}
            >
              {t("common_cancel") || "取消"}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              className="flex-1 h-9 rounded-lg text-xs shadow-xs gap-1.5"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>{t("tm_lock_confirm_btn") || "立即锁定"}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface TerminalLockOverlayProps {
  serverName?: string;
  expectedPassword: string;
  onUnlock: () => void;
}

export function TerminalLockOverlay({
  serverName,
  expectedPassword,
  onUnlock,
}: TerminalLockOverlayProps) {
  const { t } = useTranslation();
  const [inputVal, setInputVal] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inputVal === expectedPassword) {
      onUnlock();
    } else {
      setError(true);
      setInputVal("");
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-2xl p-6 select-none animate-in fade-in duration-200"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="w-full max-w-[340px] rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-2xl">
        <form onSubmit={handleUnlock} className="flex flex-col items-center text-center">
          <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20 shadow-inner">
            <Lock className="h-6 w-6 animate-pulse" />
          </div>

          <h3 className="text-base font-semibold text-foreground tracking-tight">
            {t("tm_lock_overlay_title") || "终端会话已锁定"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
            {serverName
              ? `${serverName} · ${t("tm_lock_overlay_desc") || "会话已被防护锁定"}`
              : t("tm_lock_overlay_desc") || "会话已被防护锁定"}
          </p>

          <div className="mt-5 w-full space-y-2">
            <div className="relative">
              <Input
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                placeholder={t("tm_lock_overlay_input_ph") || "输入解锁密码以继续"}
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  if (error) setError(false);
                }}
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
              >
                {showPassword ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {error && (
              <p className="text-xs font-medium text-destructive animate-in fade-in duration-150">
                {t("tm_lock_overlay_err_wrong") || "密码错误，请重新输入"}
              </p>
            )}

            <Button
              type="submit"
              className="w-full gap-2 h-9 rounded-lg text-xs font-medium shadow-xs mt-1"
              variant="default"
              disabled={!inputVal}
            >
              <Unlock className="h-3.5 w-3.5" />
              <span>{t("tm_lock_overlay_unlock_btn") || "解锁会话"}</span>
            </Button>
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/80 shrink-0" />
            <span>{t("tm_lock_overlay_safe_tip") || "锁定期间输入已被隔离，远端程序保持运行"}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
