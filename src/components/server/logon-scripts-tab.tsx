import React, { useState } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Zap,
  HelpCircle,
  Sparkles,
  Code2,
  ListOrdered,
  Clock,
  ShieldAlert,
  Download,
  Info,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  ChevronRight,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";
import type { SendExpectRule, LogonScriptsConfig } from "@/types";

interface LogonScriptsTabProps {
  config: LogonScriptsConfig;
  onChange: (config: LogonScriptsConfig) => void;
  tr: (zh: string, en: string) => string;
  isGlobalSettings?: boolean;
}

const DEFAULT_SCRIPT_TEMPLATE = `// Qshell 现代可编程交互脚本 (JavaScript / Async Engine)
// 开箱即用，免配 Python/VBScript 环境，支持 async/await
// 可用内置 API:
// - await screen.waitForString("prompt", timeoutMs) -> boolean
// - await screen.waitForStrings(["p1", "p2"], timeoutMs) -> matching index (0, 1, ...)
// - await screen.waitForRegex(/pattern/i, timeoutMs) -> RegExpExecArray | null
// - await screen.send("text", appendEnter = true)
// - await screen.sleep(milliseconds)
// - session.username, session.host, session.port, session.serverName
// - await dialog.prompt("提示信息", "默认值") -> string | null
// - dialog.toast("通知消息", "info" | "success" | "warning" | "error")

// 1. 等待登录提示并发送用户名 (支持宏变量或 session 对象)
if (await screen.waitForString("login:", 15000)) {
  await screen.sleep(200); // 延时 200ms 等待远端就绪
  await screen.send(session.username);
}

// 2. 等待密码提示并发送
if (await screen.waitForString("Password:", 15000)) {
  await screen.sleep(200);
  await screen.send("your-password-here");
}

// 3. 登录就绪后自动加载环境
if (await screen.waitForString("$", 10000)) {
  await screen.send("source ~/.bashrc");
  dialog.toast("会话已就绪，环境脚本加载完成！", "success");
}
`;

export function LogonScriptsTab({
  config,
  onChange,
  tr,
  isGlobalSettings = false,
}: LogonScriptsTabProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [syntaxStatus, setSyntaxStatus] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  const globalLogonConfig = useAppStore((s) => s.globalLogonScriptsConfig);

  const toggleShowSecret = (id: string) => {
    setShowSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleEnabled = (enabled: boolean) => {
    onChange({ ...config, enabled });
  };

  const currentMode = config.mode || "rules";

  const handleSetMode = (mode: "rules" | "script") => {
    onChange({ ...config, mode });
  };

  const handleToggleInheritGlobal = (inheritGlobal: boolean) => {
    onChange({ ...config, inheritGlobal });
  };

  const handleImportFromGlobal = () => {
    if (!globalLogonConfig || !globalLogonConfig.rules || globalLogonConfig.rules.length === 0) {
      return;
    }
    const cloned = globalLogonConfig.rules.map((r) => ({
      ...r,
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    }));
    onChange({
      ...config,
      enabled: true,
      rules: [...config.rules, ...cloned],
    });
  };

  const handleAddRule = (preset?: Partial<SendExpectRule>) => {
    const newRule: SendExpectRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      expect: preset?.expect || "",
      send: preset?.send || "",
      isSecret: preset?.isSecret ?? false,
      sendEnter: preset?.sendEnter ?? true,
      once: preset?.once ?? true,
      timeoutSec: preset?.timeoutSec ?? 30,
      delayMs: preset?.delayMs ?? 0,
      onTimeoutAction: preset?.onTimeoutAction ?? "ignore",
    };
    onChange({
      ...config,
      enabled: true,
      rules: [...config.rules, newRule],
    });
  };

  const handleUpdateRule = (id: string, updates: Partial<SendExpectRule>) => {
    const nextRules = config.rules.map((r) =>
      r.id === id ? { ...r, ...updates } : r
    );
    onChange({ ...config, rules: nextRules });
  };

  const handleDeleteRule = (id: string) => {
    onChange({
      ...config,
      rules: config.rules.filter((r) => r.id !== id),
    });
  };

  const handleMoveRule = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= config.rules.length) return;
    const next = [...config.rules];
    const [removed] = next.splice(index, 1);
    next.splice(targetIndex, 0, removed);
    onChange({ ...config, rules: next });
  };

  const checkScriptSyntax = () => {
    const code = config.customScript || DEFAULT_SCRIPT_TEMPLATE;
    try {
      new Function(
        "screen",
        "session",
        "dialog",
        `return (async () => { ${code} })();`
      );
      setSyntaxStatus({ valid: true });
    } catch (err) {
      setSyntaxStatus({
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const insertSnippet = (snippet: string) => {
    const currentCode = config.customScript ?? DEFAULT_SCRIPT_TEMPLATE;
    onChange({
      ...config,
      customScript: currentCode + "\n\n" + snippet,
    });
    setSyntaxStatus(null);
  };

  return (
    <div className="space-y-4">
      {/* 顶部主开关 */}
      <div className="flex items-center justify-between rounded-lg border border-border/70 p-3 bg-card/25 shadow-2xs">
        <div className="space-y-0.5 pr-2">
          <div className="flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-500 fill-amber-500/20" />
            <span className="text-xs font-semibold text-foreground">
              {tr("启用登录与交互自动化脚本 (Send-Expect)", "Enable Logon & Interactive Automation Scripts")}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {tr(
              "会话建立后，自动扫描终端输出并响应预设内容。支持延时发送(\\p)、宏变量(%u, %h, %p)、超时保护以及纯 JS 交互脚本编程。",
              "Watches terminal output and replies automatically. Supports pause (\\p), macros (%u, %h, %p), timeout policies, and JS async scripting."
            )}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={handleToggleEnabled}
        />
      </div>

      {/* 全局设置提示横幅（仅在全局设置对话框中展示） */}
      {isGlobalSettings && config.enabled && (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            {tr(
              "💡 此处配置系统全局默认脚本。任意服务器在编辑面板中勾选「继承全局默认脚本」，即可直接自动应用以下规则。",
              "Configured rules will act as global defaults. Enable 'Inherit Global Defaults' in any server to apply them."
            )}
          </span>
        </div>
      )}

      {config.enabled && (
        <div className="space-y-3">
          {/* 顶栏控制：模式切换与全局继承 */}
          <div className="flex items-center justify-between bg-muted/30 border border-border/60 rounded-md p-2 text-xs">
            {/* 模式选择按钮组 */}
            <div className="flex items-center gap-1 bg-background border border-border rounded-md p-0.5">
              <button
                type="button"
                onClick={() => handleSetMode("rules")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                  currentMode === "rules"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListOrdered className="h-3.5 w-3.5" />
                <span>{tr("规则表格模式", "Rules Table")}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetMode("script")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                  currentMode === "script"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>{tr("可编程 JS 脚本", "JS Script Engine")}</span>
              </button>
            </div>

            {/* 单机模式下的全局继承与导入选项 */}
            {!isGlobalSettings && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={config.inheritGlobal ?? false}
                    onChange={(e) => handleToggleInheritGlobal(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-0"
                  />
                  <span>{tr("继承全局默认脚本", "Inherit Global Defaults")}</span>
                </label>

                {globalLogonConfig?.rules && globalLogonConfig.rules.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleImportFromGlobal}
                    className="h-6 px-2 text-[11px] gap-1 cursor-pointer"
                    title={tr("从全局默认脚本配置中复制规则到当前服务器", "Copy rules from global defaults")}
                  >
                    <Download className="h-3 w-3" />
                    <span>{tr("导入全局规则", "Import Global")}</span>
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* 模式 A：规则表格模式 (Rules Table Mode) */}
          {currentMode === "rules" && (
            <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/10 shadow-2xs">
              <legend className="px-1.5 text-xs font-medium text-foreground flex items-center justify-between w-full">
                <span>{tr("Expect-Send 规则列表", "Expect-Send Rules")}</span>
                <div className="flex items-center gap-2">
                  {/* 全局超时策略选择器 */}
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
                    <span>{tr("超时动作:", "Timeout:")}</span>
                    <select
                      value={config.timeoutPolicy || "ignore"}
                      onChange={(e) =>
                        onChange({
                          ...config,
                          timeoutPolicy: e.target.value as "ignore" | "warn" | "disconnect",
                        })
                      }
                      className="h-6 text-[11px] bg-background border rounded px-1.5 font-sans"
                    >
                      <option value="ignore">{tr("静默忽略", "Ignore")}</option>
                      <option value="warn">{tr("提示警告", "Warn")}</option>
                      <option value="disconnect">{tr("强制断开", "Disconnect")}</option>
                    </select>
                  </div>

                  {/* 常用模板预设 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1 cursor-pointer">
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        <span>{tr("常用模板", "Templates")}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 text-xs">
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        {tr("身份认证与提权", "Authentication & Privilege")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "[sudo] password for",
                            send: "",
                            isSecret: true,
                            sendEnter: true,
                            once: true,
                            delayMs: 200,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("Sudo 密码响应 (带 200ms 延时)", "Sudo Password (200ms delay)")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "Are you sure you want to continue connecting",
                            send: "yes",
                            isSecret: false,
                            sendEnter: true,
                            once: true,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("跳板机主机指纹确认 (yes)", "Host Fingerprint (yes)")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "login:",
                            send: "%u",
                            isSecret: false,
                            sendEnter: true,
                            once: true,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("自动输入用户名 (宏 %u)", "Auto Username (%u macro)")}</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        {tr("网络与硬件开发", "Network & Hardware Console")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: ">",
                            send: "enable",
                            isSecret: false,
                            sendEnter: true,
                            once: true,
                            delayMs: 200,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("网络交换机 Enable 提权", "Network Switch (enable)")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "autoboot",
                            send: " ",
                            isSecret: false,
                            sendEnter: false,
                            once: true,
                            delayMs: 0,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("嵌入式设备截停 U-Boot", "U-Boot Stop Autoboot")}</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                        {tr("环境初始化", "Environment Setup")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "$",
                            send: "source ~/.bashrc",
                            isSecret: false,
                            sendEnter: true,
                            once: true,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("登录后加载 ~/.bashrc", "Load ~/.bashrc on login")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAddRule({
                            expect: "$",
                            send: "tmux a || tmux",
                            isSecret: false,
                            sendEnter: true,
                            once: true,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("登录后附加 tmux 会话", "Attach tmux session")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleAddRule()}
                    className="h-6 px-2 text-[11px] gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>{tr("添加规则", "Add Rule")}</span>
                  </Button>
                </div>
              </legend>

              {config.rules.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-md">
                  <p>{tr("暂无自动化规则，点击上方「添加规则」或选择「常用模板」创建", "No rules configured yet. Click 'Add Rule' or pick a template above.")}</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {config.rules.map((rule, idx) => {
                    const isSecretVisible = Boolean(showSecrets[rule.id]);
                    return (
                      <div
                        key={rule.id}
                        className="rounded-md border border-border/60 bg-background/80 p-2.5 space-y-2 shadow-2xs hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded w-5 text-center shrink-0">
                            {idx + 1}
                          </span>

                          {/* Expect 期望文本/正则 */}
                          <div className="flex-1 min-w-0">
                            <Input
                              value={rule.expect}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, { expect: e.target.value })
                              }
                              placeholder={tr("期望出现 (Expect)，支持普通文本或 /pattern/i", "Expect text or /pattern/i")}
                              className="h-7 text-xs font-mono"
                            />
                          </div>

                          <span className="text-muted-foreground text-xs font-semibold shrink-0">
                            ➔
                          </span>

                          {/* Send 响应发送内容 */}
                          <div className="flex-1 min-w-0 relative">
                            <Input
                              type={rule.isSecret && !isSecretVisible ? "password" : "text"}
                              value={rule.send}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, { send: e.target.value })
                              }
                              placeholder={tr("响应内容，支持 %u, %h 宏及 \\p 延时", "Send text, %u, %h macros & \\p pause")}
                              className="h-7 text-xs font-mono pr-7"
                            />
                            {rule.isSecret && (
                              <button
                                type="button"
                                onClick={() => toggleShowSecret(rule.id)}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                title={isSecretVisible ? tr("隐藏", "Hide") : tr("显示", "Show")}
                              >
                                {isSecretVisible ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* 规则顺序调整 & 删除 */}
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={idx === 0}
                              onClick={() => handleMoveRule(idx, "up")}
                              title={tr("上移", "Move Up")}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={idx === config.rules.length - 1}
                              onClick={() => handleMoveRule(idx, "down")}
                              title={tr("下移", "Move Down")}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteRule(rule.id)}
                              title={tr("删除", "Delete")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* 选项栏：延时、脱敏、回车、单次、超时及处置 */}
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pl-7">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-foreground">
                            <input
                              type="checkbox"
                              checked={rule.isSecret ?? false}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, { isSecret: e.target.checked })
                              }
                              className="rounded border-border text-primary focus:ring-0"
                            />
                            <span>{tr("密码脱敏", "Masked")}</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-foreground">
                            <input
                              type="checkbox"
                              checked={rule.sendEnter !== false}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, { sendEnter: e.target.checked })
                              }
                              className="rounded border-border text-primary focus:ring-0"
                            />
                            <span>{tr("附加回车(\\r)", "Enter(\\r)")}</span>
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-foreground">
                            <input
                              type="checkbox"
                              checked={rule.once !== false}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, { once: e.target.checked })
                              }
                              className="rounded border-border text-primary focus:ring-0"
                            />
                            <span>{tr("仅单次", "Once")}</span>
                          </label>

                          {/* 匹配后延时毫秒数 */}
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground/80" />
                            <span>{tr("延时:", "Delay:")}</span>
                            <input
                              type="number"
                              min={0}
                              max={10000}
                              step={50}
                              value={rule.delayMs ?? 0}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, {
                                  delayMs: Math.max(0, parseInt(e.target.value) || 0),
                                })
                              }
                              className="w-12 h-5 text-[10px] font-mono text-center border rounded bg-background"
                              title={tr("匹配后等待 N 毫秒再发送，防止远端输入缓冲未就绪丢字", "Delay in ms before sending")}
                            />
                            <span>ms</span>
                          </div>

                          {/* 超时时间 */}
                          <div className="flex items-center gap-1">
                            <span>{tr("超时:", "Timeout:")}</span>
                            <input
                              type="number"
                              min={5}
                              max={300}
                              value={rule.timeoutSec ?? 30}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, {
                                  timeoutSec: parseInt(e.target.value) || 30,
                                })
                              }
                              className="w-10 h-5 text-[10px] font-mono text-center border rounded bg-background"
                            />
                            <span>s</span>
                          </div>

                          {/* 超时处置 */}
                          <div className="flex items-center gap-1 ml-auto">
                            <ShieldAlert className="h-3 w-3 text-muted-foreground/80" />
                            <span>{tr("超时处置:", "On Timeout:")}</span>
                            <select
                              value={rule.onTimeoutAction || "ignore"}
                              onChange={(e) =>
                                handleUpdateRule(rule.id, {
                                  onTimeoutAction: e.target.value as "ignore" | "warn" | "disconnect",
                                })
                              }
                              className="h-5 text-[10px] bg-background border rounded px-1 font-sans"
                            >
                              <option value="ignore">{tr("忽略", "Ignore")}</option>
                              <option value="warn">{tr("警告", "Warn")}</option>
                              <option value="disconnect">{tr("断开", "Disconnect")}</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 宏变量与转义帮助贴纸 */}
              <div className="bg-muted/40 rounded border border-border/50 p-2 text-[11px] text-muted-foreground space-y-1">
                <div className="flex items-center gap-1 font-medium text-foreground">
                  <Info className="h-3.5 w-3.5 text-primary" />
                  <span>{tr("支持的高级转义字符与宏变量 (对标并超越 Xshell)", "Supported Macros & Escape Sequences")}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px] font-mono text-muted-foreground/90">
                  <div><span className="text-primary font-semibold">%u</span>: {tr("当前用户名", "Username")}</div>
                  <div><span className="text-primary font-semibold">%h</span>: {tr("当前主机/IP", "Host IP")}</div>
                  <div><span className="text-primary font-semibold">%p</span>: {tr("当前端口", "Port")}</div>
                  <div><span className="text-primary font-semibold">%n</span>: {tr("服务器名", "Server Name")}</div>
                  <div><span className="text-amber-500 font-semibold">\p</span>: {tr("暂停 1000ms", "Pause 1s")}</div>
                  <div><span className="text-amber-500 font-semibold">\p500</span>: {tr("暂停 500ms", "Pause 500ms")}</div>
                  <div><span className="text-foreground font-semibold">\r, \n</span>: {tr("回车换行", "CR / LF")}</div>
                  <div><span className="text-foreground font-semibold">/pattern/i</span>: {tr("正则表达式", "RegExp")}</div>
                </div>
              </div>
            </fieldset>
          )}

          {/* 模式 B：现代可编程 JavaScript 脚本模式 (Programmable Script Mode) */}
          {currentMode === "script" && (
            <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/10 shadow-2xs">
              <legend className="px-1.5 text-xs font-medium text-foreground flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-primary" />
                  <span>{tr("JavaScript 异步自动化脚本 (免安装 Python/VBScript)", "JavaScript Async Automation Script")}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* 代码片段插入器 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1 cursor-pointer">
                        <Terminal className="h-3 w-3 text-primary" />
                        <span>{tr("代码片段", "Snippets")}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 text-xs">
                      <DropdownMenuItem
                        onClick={() =>
                          insertSnippet(
                            'if (await screen.waitForString("prompt:", 10000)) {\n  await screen.send("my-input");\n}'
                          )
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("等待文本并发送 (waitForString)", "waitForString + send")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          insertSnippet(
                            'const idx = await screen.waitForStrings(["Password:", "OTP Code:"], 10000);\nif (idx === 0) {\n  await screen.send("pass");\n} else if (idx === 1) {\n  const code = await dialog.prompt("输入口令:");\n  if (code) await screen.send(code);\n}'
                          )
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("多分支等待 (waitForStrings)", "waitForStrings branch")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          insertSnippet(
                            'const val = await dialog.prompt("请输入参数:", "default");\nif (val) await screen.send(val);'
                          )
                        }
                        className="cursor-pointer"
                      >
                        <span>{tr("弹窗交互输入 (dialog.prompt)", "dialog.prompt")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => insertSnippet('await screen.sleep(500);')}
                        className="cursor-pointer"
                      >
                        <span>{tr("延时等待 (screen.sleep)", "screen.sleep")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 语法检测按钮 */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={checkScriptSyntax}
                    className="h-6 px-2 text-[11px] gap-1 cursor-pointer"
                  >
                    <PlayCircle className="h-3 w-3 text-emerald-500" />
                    <span>{tr("检测语法", "Check Syntax")}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onChange({
                        ...config,
                        customScript: DEFAULT_SCRIPT_TEMPLATE,
                      });
                      setSyntaxStatus(null);
                    }}
                    className="h-6 px-2 text-[11px] gap-1 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 text-amber-500" />
                    <span>{tr("重置示例", "Reset Template")}</span>
                  </Button>
                </div>
              </legend>

              {/* 语法检测状态栏 */}
              {syntaxStatus && (
                <div
                  className={cn(
                    "flex items-center gap-1.5 p-2 rounded text-xs",
                    syntaxStatus.valid
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : "bg-destructive/10 text-destructive border border-destructive/20"
                  )}
                >
                  {syntaxStatus.valid ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{tr("JavaScript 语法检查通过，可以正常执行！", "Syntax is valid and ready to execute!")}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="font-mono text-[11px]">{syntaxStatus.error}</span>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <textarea
                  value={config.customScript ?? DEFAULT_SCRIPT_TEMPLATE}
                  onChange={(e) => {
                    onChange({
                      ...config,
                      customScript: e.target.value,
                    });
                    if (syntaxStatus) setSyntaxStatus(null);
                  }}
                  rows={14}
                  spellCheck={false}
                  placeholder={tr("在此编写标准的 async/await JavaScript 登录脚本...", "Write async JavaScript logon script here...")}
                  className="w-full rounded-md border border-border/80 bg-zinc-950 text-zinc-100 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50"
                />

                <div className="bg-muted/40 rounded border border-border/50 p-2.5 text-[11px] text-muted-foreground space-y-1.5">
                  <span className="font-semibold text-foreground">{tr("内置可用 API 说明:", "Built-in API Reference:")}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px]">
                    <div><span className="text-primary">await screen.waitForString(str, ms)</span> - {tr("等待指定子串出现", "Wait for substring")}</div>
                    <div><span className="text-primary">await screen.waitForStrings([s1, s2], ms)</span> - {tr("多选等待，返回命中索引", "Wait for any")}</div>
                    <div><span className="text-primary">await screen.waitForRegex(/re/i, ms)</span> - {tr("正则匹配", "Wait for regex")}</div>
                    <div><span className="text-primary">await screen.send(text, enter?)</span> - {tr("向 Shell 发送指令", "Send text to shell")}</div>
                    <div><span className="text-primary">await screen.sleep(ms)</span> - {tr("延时挂起", "Pause execution")}</div>
                    <div><span className="text-primary">await dialog.prompt(msg, def)</span> - {tr("弹窗交互式索取动态口令", "Prompt user")}</div>
                  </div>
                </div>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
