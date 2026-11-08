/**
 * Kubernetes 集群概览模块（Phase 2-C）
 *
 * 挂在既有「设备管理」工作台容器下，按 server.targetType 分派渲染；
 * 不建立 SSH 连接，只通过 `k8s_get_overview` 读取 API Server 信息。
 *
 * 文案采用组件内中英双语（其余语言显示英文），与 EsxiModule 一致，
 * 已登记在 docs/DEVICE_TYPE_EXTENSION_RISKS.md。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { AlertTriangle, Boxes, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { sshService } from "@/services/ssh-service";
import type { K8sOverview } from "@/services/api/types";

interface K8sModuleProps {
  serverId: string;
  isActive?: boolean;
}

export function K8sModule({ serverId, isActive = true }: K8sModuleProps) {
  const { language } = useTranslation();
  const isZh = (language ?? "").toLowerCase().startsWith("zh");
  const L = (zh: string, en: string) => (isZh ? zh : en);
  const [overview, setOverview] = useState<K8sOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      setOverview(await sshService.getK8sOverview(serverId));
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
    { label: L("集群版本", "Cluster version"), value: overview?.gitVersion },
    { label: L("平台", "Platform"), value: overview?.platform },
    { label: L("节点数", "Nodes"), value: overview?.nodeCount },
    { label: L("Ready 节点", "Ready nodes"), value: overview?.readyNodeCount },
    { label: L("命名空间", "Namespaces"), value: overview?.namespaceCount },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">{L("Kubernetes 集群概览", "Kubernetes cluster overview")}</h2>
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
                "请检查 API Server 地址/端口、Bearer Token 与 RBAC 权限，以及是否允许自签名证书。",
                "Check the API Server address/port, Bearer Token and RBAC permissions, and whether self-signed certificates are allowed.",
              )}
            </p>
          </div>
        )}

        {overview?.success && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {L("API Server 连接与鉴权成功", "API Server connection and authorization succeeded")}
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
            {overview.apiUrl && (
              <a
                href={`${overview.apiUrl}/version`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {overview.apiUrl}
              </a>
            )}
          </>
        )}

        {!overview && !loading && (
          <p className="text-sm text-muted-foreground">
            {L("正在等待集群信息…", "Waiting for cluster information…")}
          </p>
        )}
      </div>
    </div>
  );
}
