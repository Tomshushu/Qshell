import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SftpViewMode } from "@/types";
import { setSoundEnabled } from "@/lib/sound";
import { sshService } from "@/services/ssh-service";
import { FONT_PRESETS } from "@/lib/font-presets";
import {
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
  DEFAULT_SFTP_EXCLUSIONS,
  NEW_HIGHLIGHT_RULES,
} from "./constants";
import { saveWorkspaceSession } from "./workspace-helpers";
import type { AppState } from "./types";
import { createUiSlice } from "./slices/ui-slice";
import { createServerSlice } from "./slices/server-slice";
import { createTerminalSlice } from "./slices/terminal-slice";
import { createSftpSlice } from "./slices/sftp-slice";
import { createWorkspaceSlice } from "./slices/workspace-slice";

export {
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
  DEFAULT_SFTP_EXCLUSIONS,
} from "./constants";
export type { ServerStateEntry, UiStyleId, AppState, AppLockType } from "./types";

export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createUiSlice(...a),
      ...createServerSlice(...a),
      ...createTerminalSlice(...a),
      ...createSftpSlice(...a),
      ...createWorkspaceSlice(...a),
    }),
    {
      name: "qshell-storage",
      partialize: (state) => ({
        theme: state.theme,
        uiStyle: state.uiStyle,
        customCursorEnabled: state.customCursorEnabled,
        uiSoundEnabled: state.uiSoundEnabled,
        autoRefresh: state.autoRefresh,
        refreshInterval: state.refreshInterval,
        terminalFontSize: state.terminalFontSize,
        terminalFontFamily: state.terminalFontFamily,
        terminalThemeId: state.terminalThemeId,
        customTerminalThemes: state.customTerminalThemes,
        terminalThemeOverrides: state.terminalThemeOverrides,
        terminalHighlightEnabled: state.terminalHighlightEnabled,
        terminalHighlightRules: state.terminalHighlightRules,
        terminalAutoReconnect: state.terminalAutoReconnect,
        terminalAntiIdleEnabled: state.terminalAntiIdleEnabled,
        terminalAntiIdleInterval: state.terminalAntiIdleInterval,
        terminalAntiIdleMode: state.terminalAntiIdleMode,
        terminalAntiIdleCustomString: state.terminalAntiIdleCustomString,
        terminalCopyPaste: state.terminalCopyPaste,
        terminalPasteWarnEnabled: state.terminalPasteWarnEnabled,
        terminalSelectionToolbar: state.terminalSelectionToolbar,
        terminalBellSound: state.terminalBellSound,
        terminalDrawBoldInBrightColors: state.terminalDrawBoldInBrightColors,
        terminalHintEnabled: state.terminalHintEnabled,
        terminalScrollbackLines: state.terminalScrollbackLines,
        terminalWindowSizeKb: state.terminalWindowSizeKb,
        terminalRecordingDirectory: state.terminalRecordingDirectory,
        terminalEncoding: state.terminalEncoding,
        terminalRecordingMaxSizeMb: state.terminalRecordingMaxSizeMb,
        sftpDefaultViewMode: state.sftpDefaultViewMode,
        sftpLocalViewMode: state.sftpLocalViewMode,
        sftpRemoteViewMode: state.sftpRemoteViewMode,
        sftpLocalShowHidden: state.sftpLocalShowHidden,
        sftpRemoteShowHidden: state.sftpRemoteShowHidden,
        sftpLocalSortField: state.sftpLocalSortField,
        sftpLocalSortOrder: state.sftpLocalSortOrder,
        sftpRemoteSortField: state.sftpRemoteSortField,
        sftpRemoteSortOrder: state.sftpRemoteSortOrder,
        pathBookmarks: state.pathBookmarks,
        workspaceFileSortField: state.workspaceFileSortField,
        workspaceFileSortDirection: state.workspaceFileSortDirection,
        workspaceFileShowHidden: state.workspaceFileShowHidden,
        sftpFileIconTheme: state.sftpFileIconTheme,
        sftpTransferConcurrency: state.sftpTransferConcurrency,
        transferRateLimit: state.transferRateLimit,
        sftpExclusionEnabled: state.sftpExclusionEnabled,
        sftpExclusionPatterns: state.sftpExclusionPatterns,
        sftpRespectGitignore: state.sftpRespectGitignore,
        sidebarWidth: state.sidebarWidth,
        language: state.language,
        // Application Lock 持久化（冷启动永不锁定，仅在运行时根据空闲或手动锁定生效）
        appLockEnabled: state.appLockEnabled,
        appLockType: state.appLockType,
        appLockPasswordHash: state.appLockPasswordHash,
        appLockIdleMinutes: state.appLockIdleMinutes,
        // tabColors 持久化：tab 本身不持久化，但用户设置的标签颜色要以 serverId
        // 为键记住，下次打开同一服务器工作台时自动套用。
        tabColors: state.tabColors,
        // keys 不持久化：SSH 密钥（含 passphrase / 私钥内容）由后端 SQLite 加密存储，
        // 是唯一 source of truth。原 localStorage 持久化会导致 passphrase 明文泄漏。
        // servers 不持久化：SQLite 是唯一 source of truth，避免双源同步问题
        // tabs/activeTabId 不持久化：应用重启后由用户按需重新打开工作台，
        // 避免恢复标签却必须重新建立远端 Shell 所带来的误导体验。
      }),
      onRehydrateStorage: () => (state) => {
        // 冷启动永不锁屏：确保关闭应用后下一次打开始终直接进入未锁定的主界面
        if (state) {
          state.isAppLocked = false;
        }
        // 迁移：自定义字体功能已移除，将不在预设列表中的字体重置为默认预设
        if (state?.terminalFontFamily) {
          const presetValues = FONT_PRESETS.map((f) => f.value);
          if (!presetValues.includes(state.terminalFontFamily)) {
            state.terminalFontFamily = '"Cascadia Code", monospace';
          }
        }
        if (state) {
          // 迁移：防空闲断开（Anti-Idle）字符注入功能。
          // 1. 底层 russh 传输层已具备每 15 秒一次的纯 SSH 协议心跳，连接永不断开，
          //    绝大多数用户根本无需向 Shell stdin 注入控制字符。
          // 2. 旧版本默认开启了 enter（\r 回车）保活，会导致查看日志、长时间无输入时 Shell 不断打印空行并将日志顶出视口。
          // 迁移修复：若持久化中残留了旧的 "enter" 模式，重置为静默安全的 "null"；并将字符级保活重置为关闭状态。
          if (state.terminalAntiIdleMode === "enter") {
            state.terminalAntiIdleMode = "null";
            state.terminalAntiIdleEnabled = false;
          }
          // 迁移：全局界面音效开关原本由「终端铃声」兼职控制（旧版本在 terminal.tsx 的
          // effect 里同步 setSoundEnabled）。拆出独立字段后，旧版本没有 uiSoundEnabled，
          // 继承当时终端铃声的值，避免升级后所有界面音效（提示音/按钮音等）突然静音。
          if (typeof state.uiSoundEnabled !== "boolean") {
            state.uiSoundEnabled = state.terminalBellSound === true;
          }
          // rehydrate 后立即同步到 sound.ts 的模块级开关：
          // 不再依赖终端组件挂载，任何页面下全局音效都能正确生效。
          setSoundEnabled(state.uiSoundEnabled === true);
          // 侧边栏宽度：旧版本无此字段或值非法（NaN/越界）时回退默认宽度
          if (
            typeof state.sidebarWidth !== "number" ||
            !Number.isFinite(state.sidebarWidth)
          ) {
            state.sidebarWidth = SIDEBAR_WIDTH_DEFAULT;
          } else {
            state.sidebarWidth = Math.max(
              SIDEBAR_WIDTH_MIN,
              Math.min(SIDEBAR_WIDTH_MAX, Math.round(state.sidebarWidth)),
            );
          }
          // 录制已改为直接写文件，丢弃旧版本的内存缓存配置。
          delete (
            state as Partial<AppState> & { terminalRecordingLimitMb?: unknown }
          ).terminalRecordingLimitMb;
          delete (
            state as Partial<AppState> & {
              terminalClearRecordingAfterExport?: unknown;
            }
          ).terminalClearRecordingAfterExport;
          // 迁移：补充新增的高亮规则（IPv6 / URL / Email / Port）。按 id 去重追加到
          // 老用户已持久化的规则之后，不影响其自定义规则；全新用户已在默认数组里带上。
          if (Array.isArray(state.terminalHighlightRules)) {
            const existingIds = new Set(
              state.terminalHighlightRules.map((r) => r.id),
            );
            const missing = NEW_HIGHLIGHT_RULES.filter(
              (r) => !existingIds.has(r.id),
            );
            if (missing.length > 0) {
              state.terminalHighlightRules = [
                ...state.terminalHighlightRules,
                ...missing,
              ];
            }
            // 迁移：MAC 规则默认色由品红 #ec4899 改为青色 #2dd4bf（与 IP/IPv6 拉开区分）。
            // 仅当用户未自定义过此规则（仍停留在旧默认色）时才同步，避免覆盖用户改过的颜色。
            state.terminalHighlightRules = state.terminalHighlightRules.map((r) =>
              r.id === "7" && r.color === "#ec4899"
                ? { ...r, color: "#2dd4bf" }
                : r,
            );
          }
          // 工作台打开数量不设上限；旧版本的 terminalMaxSessions 配置直接忽略。
          delete (
            state as Partial<AppState> & { terminalMaxSessions?: unknown }
          ).terminalMaxSessions;
          // 确保 sftpDefaultViewMode 处于有效选项范围
          const validViewModes: SftpViewMode[] = ["list", "large", "medium", "small"];
          if (
            !state.sftpDefaultViewMode ||
            !validViewModes.includes(state.sftpDefaultViewMode)
          ) {
            state.sftpDefaultViewMode = "list";
          }
          if (
            !state.sftpLocalViewMode ||
            !validViewModes.includes(state.sftpLocalViewMode)
          ) {
            state.sftpLocalViewMode = state.sftpDefaultViewMode || "list";
          }
          if (
            !state.sftpRemoteViewMode ||
            !validViewModes.includes(state.sftpRemoteViewMode)
          ) {
            state.sftpRemoteViewMode = state.sftpDefaultViewMode || "list";
          }
          if (typeof state.sftpLocalShowHidden !== "boolean") {
            state.sftpLocalShowHidden = false;
          }
          if (typeof state.sftpRemoteShowHidden !== "boolean") {
            state.sftpRemoteShowHidden = true;
          }
          const validSortFields: Array<"name" | "size" | "modified"> = ["name", "size", "modified"];
          const validSortOrders: Array<"asc" | "desc"> = ["asc", "desc"];
          if (!state.sftpLocalSortField || !validSortFields.includes(state.sftpLocalSortField)) {
            state.sftpLocalSortField = "name";
          }
          if (!state.sftpLocalSortOrder || !validSortOrders.includes(state.sftpLocalSortOrder)) {
            state.sftpLocalSortOrder = "asc";
          }
          if (!state.sftpRemoteSortField || !validSortFields.includes(state.sftpRemoteSortField)) {
            state.sftpRemoteSortField = "name";
          }
          if (!state.sftpRemoteSortOrder || !validSortOrders.includes(state.sftpRemoteSortOrder)) {
            state.sftpRemoteSortOrder = "asc";
          }
          if (!state.pathBookmarks || typeof state.pathBookmarks !== 'object') {
            state.pathBookmarks = {};
          }
          if (!state.workspaceFileSortField || !['name', 'size', 'modifiedTime'].includes(state.workspaceFileSortField)) {
            state.workspaceFileSortField = 'name';
          }
          if (!state.workspaceFileSortDirection || !['asc', 'desc'].includes(state.workspaceFileSortDirection)) {
            state.workspaceFileSortDirection = 'asc';
          }
          if (typeof state.workspaceFileShowHidden !== 'boolean') {
            state.workspaceFileShowHidden = true;
          }
          // 确保 sftpFileIconTheme 处于有效选项范围
          if (
            !state.sftpFileIconTheme ||
            !["precision", "yaru", "developer", "minimal"].includes(state.sftpFileIconTheme)
          ) {
            state.sftpFileIconTheme = "developer";
          }
          // 迁移：排除规则默认关闭，纯粹的文件传输默认不忽略任何内容
          const exclusionMigrationKey = "qshell-exclusion-default-off-v1";
          if (typeof window !== "undefined" && !localStorage.getItem(exclusionMigrationKey)) {
            state.sftpExclusionEnabled = false;
            state.sftpRespectGitignore = false;
            localStorage.setItem(exclusionMigrationKey, "1");
          } else {
            if (typeof state.sftpExclusionEnabled !== "boolean") {
              state.sftpExclusionEnabled = false;
            }
            if (typeof state.sftpRespectGitignore !== "boolean") {
              state.sftpRespectGitignore = false;
            }
          }
          if (!Array.isArray(state.sftpExclusionPatterns)) {
            state.sftpExclusionPatterns = [...DEFAULT_SFTP_EXCLUSIONS];
          }
          // 重新激活或启动时，同步传输排除规则给后端
          sshService
            .setExclusionConfig(
              state.sftpExclusionEnabled,
              state.sftpExclusionPatterns,
              state.sftpRespectGitignore,
            )
            .catch((err) => {
              console.error("Failed to sync exclusion config on rehydrate:", err);
            });
        }
      },
    },
  ),
);

// 自动将会话级工作台状态同步到 sessionStorage，防止意外刷新、休眠唤醒或 HMR 时丢失打开的标签
if (typeof window !== "undefined") {
  useAppStore.subscribe((state) => {
    saveWorkspaceSession({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      workspaces: state.workspaces,
      groups: state.groups,
      layout: state.layout,
      lastActiveGroupId: state.lastActiveGroupId,
    });
  });
}
