/**
 * ESXi / vCenter 主机概览模块（Phase 2-B-3）
 *
 * 挂在既有「设备管理」工作台容器（module key = bmc）下，按 server.targetType
 * 分派渲染；不建立 SSH 连接，只通过 `esxi_get_overview` 读取 HTTPS REST 信息。
 *
 * 文案采用组件内中英双语（其余语言显示英文），未接入 27 语言 i18n 键，
 * 已登记在 docs/DEVICE_TYPE_EXTENSION_RISKS.md。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Server } from "lucide-react";
import { sshService } from "@/services/ssh-service";
import type { EsxiOverview } from "@/services/api/types";

interface EsxiModuleProps {
  serverId: string;
  isActive?: boolean;
}

export function EsxiModule({ serverId, isActive = true }: EsxiModuleProps) {
  const { language } = useTranslation();
  const isZh = (language ?? "").toLowerCase().startsWith("zh");
  const L = (zh: string, en: string) => (isZh ? zh : en);
  const [overview, setOverview] = useState<EsxiOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      setOverview(await sshService.getEsxiOverview(serverId));
    } catch (error) {
      setOverview({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  const fields: { label: string; value?: string | number }[] = [
    { label: L("产品", "Product"), value: overview?.productName },
    { label: L("版本", "Version"), value: overview?.version },
    { label: L("API 版本", "API version"), value: overview?.apiVersion },
    { label: L("主机名称", "Host name"), value: overview?.hostName },
    {
      label: L("纳管主机数", "Managed hosts"),
      value: overview?.hostCount === undefined ? undefined : overview.hostCount,
    },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">{L("ESXi / vCenter 概览", "ESXi / vCenter overview")}</h2>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? L("读取中…", "Loading…") : L("刷新", "Refresh")}
          </button>
        </div>

        {overview && !overview.success && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {L("连接失败", "Connection failed")}
            </div>
            <p className="mt-2 break-words text-xs text-muted-foreground">{overview.error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {L(
                "请检查 HTTPS 端口、账号密码，以及是否在表单中允许自签名证书。",
                "Check the HTTPS port, credentials, and whether self-signed certificates are allowed in the form.",
              )}
            </p>
          </div>
        )}

        {overview?.success && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {L("HTTPS 连接与认证成功", "HTTPS connection and authentication succeeded")}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.label} className="rounded-lg border border-border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground">{field.label}</div>
                  <div className="mt-1 truncate text-sm font-medium">
                    {field.value === undefined ? "—" : field.value}
                  </div>
                </div>
              ))}
            </div>
            {overview.webUrl && (
              <a
                href={overview.webUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {overview.webUrl}
              </a>
            )}
          </>
        )}

        {!overview && !loading && (
          <p className="text-sm text-muted-foreground">
            {L("正在等待主机信息…", "Waiting for host information…")}
          </p>
        )}
      </div>
    </div>
  );
}
