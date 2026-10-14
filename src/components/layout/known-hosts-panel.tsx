import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Loader2,
  KeyRound,
  Server,
  AlertTriangle,
  Info,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { playSound, SoundType } from "@/lib/sound";
import { sshService } from "@/services/ssh-service";
import type { KnownHostRecord } from "@/services/api/types";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function getKeyTypeBadge(keyType: string) {
  const kt = keyType.toLowerCase();
  let color = "bg-primary/10 text-primary border-primary/20";
  if (kt.includes("ed25519")) {
    color = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  } else if (kt.includes("rsa")) {
    color = "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
  } else if (kt.includes("ecdsa")) {
    color = "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
  }
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium border",
        color,
      )}
    >
      {keyType}
    </span>
  );
}

export function KnownHostsPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [hosts, setHosts] = useState<KnownHostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchHosts = useCallback(async () => {
    try {
      setLoading(true);
      const list = await sshService.listKnownHosts();
      setHosts(list);
    } catch (err) {
      console.error("Failed to load known hosts:", err);
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchHosts();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHosts]);

  const filteredHosts = useMemo(() => {
    if (!search.trim()) return hosts;
    const q = search.toLowerCase().trim();
    return hosts.filter(
      (h) =>
        h.host.toLowerCase().includes(q) ||
        String(h.port).includes(q) ||
        h.keyType.toLowerCase().includes(q) ||
        h.fingerprint.toLowerCase().includes(q),
    );
  }, [hosts, search]);

  const handleCopyFingerprint = async (record: KnownHostRecord) => {
    try {
      const textToCopy = record.fingerprint || record.keyValue;
      await navigator.clipboard.writeText(textToCopy);
      const keyId = `${record.host}:${record.port}:${record.keyType}`;
      setCopiedKey(keyId);
      playSound(SoundType.CLICK);
      toast.success(t("known_hosts_copied"));
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleDeleteHost = async (record: KnownHostRecord) => {
    const keyId = `${record.host}:${record.port}:${record.keyType}`;
    setDeletingKey(keyId);
    try {
      const res = await sshService.deleteKnownHost(
        record.host,
        record.port,
        record.keyType,
      );
      if (res.success) {
        playSound(SoundType.SWITCH);
        toast.success(res.message || t("known_hosts_deleted"));
        await fetchHosts();
      } else {
        toast.error(res.message || t("common_error"));
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeletingKey(null);
    }
  };

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const res = await sshService.clearAllKnownHosts();
      if (res.success) {
        playSound(SoundType.SWITCH);
        toast.success(res.message || t("known_hosts_cleared"));
        await fetchHosts();
      } else {
        toast.error(res.message || t("common_error"));
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setClearing(false);
      setShowClearConfirm(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* 头部卡片 */}
      <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
        <CardContent className="p-6 flex flex-col gap-4 text-xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  {t("sidebar_known_hosts")}
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-primary/10 text-primary border border-primary/20">
                    {hosts.length}
                  </span>
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t("known_hosts_desc")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => void fetchHosts()}
                disabled={loading}
              >
                <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                {t("known_hosts_refresh")}
              </Button>
              {hosts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-rose-500/20"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={loading || clearing}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("known_hosts_clear_all")}
                </Button>
              )}
            </div>
          </div>

          {/* 搜索过滤栏 */}
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("known_hosts_search_placeholder")}
              className="pl-8 h-9 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* 主机指纹列表 */}
      <Card className="border/50 bg-background shadow-sm rounded-lg overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
              <span>{t("common_loading")}</span>
            </div>
          ) : filteredHosts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground select-none">
              <ShieldAlert className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs font-medium text-foreground mb-1">
                {search ? t("lcr_no_match") : t("known_hosts_empty")}
              </p>
              <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                {search
                  ? t("known_hosts_no_search_match")
                  : t("known_hosts_empty_hint")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filteredHosts.map((record) => {
                const keyId = `${record.host}:${record.port}:${record.keyType}`;
                const isCopied = copiedKey === keyId;
                const isDeleting = deletingKey === keyId;
                const formattedDate = new Date(record.createdAt).toLocaleString(
                  undefined,
                  {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  },
                );

                return (
                  <div
                    key={keyId}
                    className="p-4 hover:bg-muted/15 transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="p-2 rounded-md bg-muted/40 text-muted-foreground shrink-0 mt-0.5">
                        <Server className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground font-mono text-xs">
                            {record.host}:{record.port}
                          </span>
                          {getKeyTypeBadge(record.keyType)}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code
                            className="text-[11px] font-mono text-muted-foreground/90 bg-muted/40 px-1.5 py-0.5 rounded break-all select-all hover:text-foreground transition-colors cursor-pointer"
                            onClick={() => void handleCopyFingerprint(record)}
                            title={t("lcr_click_copy")}
                          >
                            {record.fingerprint || record.keyValue}
                          </code>
                          <button
                            type="button"
                            onClick={() => void handleCopyFingerprint(record)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title={t("known_hosts_copy_fingerprint")}
                          >
                            {isCopied ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                          <Clock className="h-3 w-3" />
                          <span>{formattedDate}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                        onClick={() => void handleDeleteHost(record)}
                        disabled={isDeleting}
                        title={t("known_hosts_delete_host")}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 确认清空全部弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2 rounded-full bg-rose-500/10">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                {t("known_hosts_clear_confirm_title")}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("known_hosts_clear_confirm_desc")}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                {t("common_cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleClearAll()}
                disabled={clearing}
                className="gap-1.5"
              >
                {clearing && <Loader2 className="h-3 w-3 animate-spin" />}
                {t("known_hosts_clear_confirm_btn")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
