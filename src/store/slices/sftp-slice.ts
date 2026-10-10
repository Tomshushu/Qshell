import type { StateCreator } from "zustand";
import { sshService } from "@/services/ssh-service";
import { DEFAULT_SFTP_EXCLUSIONS } from "../constants";
import type { AppState, SftpSlice } from "../types";

export const createSftpSlice: StateCreator<AppState, [], [], SftpSlice> = (
  set,
  get,
) => ({
  // SFTP Settings Defaults & Setters
  // SFTP 本地面板默认视图模式：默认 'list'
  sftpLocalViewMode: "list",
  setSftpLocalViewMode: (mode) => set({ sftpLocalViewMode: mode }),
  // SFTP 远程面板默认视图模式：默认 'list'
  sftpRemoteViewMode: "list",
  setSftpRemoteViewMode: (mode) => set({ sftpRemoteViewMode: mode }),
  // SFTP 本地面板默认是否显示隐藏文件：默认 false
  sftpLocalShowHidden: false,
  setSftpLocalShowHidden: (show) => set({ sftpLocalShowHidden: show }),
  // SFTP 远程面板默认是否显示隐藏文件：默认 true
  sftpRemoteShowHidden: true,
  setSftpRemoteShowHidden: (show) => set({ sftpRemoteShowHidden: show }),
  // SFTP 默认视图模式（向后兼容）：默认 'list'
  sftpDefaultViewMode: "list",
  setSftpDefaultViewMode: (mode) =>
    set({
      sftpDefaultViewMode: mode,
      sftpLocalViewMode: mode,
      sftpRemoteViewMode: mode,
    }),
  // SFTP 文件图标主题：默认 'developer'
  sftpFileIconTheme: "developer",
  setSftpFileIconTheme: (theme) => set({ sftpFileIconTheme: theme }),
  // SFTP 传输并发量（1-10）：默认 3
  sftpTransferConcurrency: 3,
  setSftpTransferConcurrency: (n) =>
    set({
      sftpTransferConcurrency: Math.max(
        1,
        Math.min(10, Math.floor(n) || 1),
      ),
    }),
  // 传输限速（KB/s）：默认 0=不限速；负值归一化为 0
  transferRateLimit: 0,
  setTransferRateLimit: (kbps) => {
    const normalized = Math.max(0, Math.floor(kbps) || 0);
    set({ transferRateLimit: normalized });
    // 立即同步到后端，避免仅在 SFTP 面板挂载时才生效（dashboard 上改设置也能生效）
    sshService.setTransferRateLimit(normalized).catch((err) => {
      console.error("Failed to sync transfer rate limit to backend:", err);
    });
  },
  // SFTP 传输排除与忽略规则（默认关闭，保持纯粹的文件传输）
  sftpExclusionEnabled: false,
  setSftpExclusionEnabled: (enabled) => {
    set({ sftpExclusionEnabled: enabled });
    const { sftpExclusionPatterns, sftpRespectGitignore } = get();
    sshService
      .setExclusionConfig(enabled, sftpExclusionPatterns, sftpRespectGitignore)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },
  sftpExclusionPatterns: DEFAULT_SFTP_EXCLUSIONS,
  setSftpExclusionPatterns: (patterns) => {
    set({ sftpExclusionPatterns: patterns });
    const { sftpExclusionEnabled, sftpRespectGitignore } = get();
    sshService
      .setExclusionConfig(sftpExclusionEnabled, patterns, sftpRespectGitignore)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },
  sftpRespectGitignore: false,
  setSftpRespectGitignore: (respect) => {
    set({ sftpRespectGitignore: respect });
    const { sftpExclusionEnabled, sftpExclusionPatterns } = get();
    sshService
      .setExclusionConfig(sftpExclusionEnabled, sftpExclusionPatterns, respect)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },
});
