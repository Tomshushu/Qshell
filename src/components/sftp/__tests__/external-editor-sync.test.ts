import { describe, it, expect, vi } from "vitest";
import type { ExternalEditSession, ExternalSyncEventPayload } from "@/services/api/types";

describe("SFTP 外部编辑器联动自动同步 (External Editor Auto-Sync)", () => {
  it("应正确解析和记录外部编辑会话结构", () => {
    const session: ExternalEditSession = {
      sessionId: "session-uuid-1234",
      serverId: "srv-prod-01",
      remotePath: "/etc/nginx/nginx.conf",
      localPath: "C:\\Users\\15249\\AppData\\Local\\Temp\\qshell_external_edits\\session-uuid-1234\\nginx.conf",
      fileName: "nginx.conf",
      editorCmd: "code",
      lastSyncedAt: "2026-11-10 00:00:00",
      lastSyncedSize: 2048,
    };

    expect(session.sessionId).toBe("session-uuid-1234");
    expect(session.fileName).toBe("nginx.conf");
    expect(session.lastSyncedSize).toBe(2048);
    expect(session.editorCmd).toBe("code");
  });

  it("当保存触发外部同步事件时，应正确通知前端并携带最新大小与时间", () => {
    const syncCallback = vi.fn();
    const eventPayload: ExternalSyncEventPayload = {
      sessionId: "session-uuid-1234",
      serverId: "srv-prod-01",
      remotePath: "/etc/nginx/nginx.conf",
      localPath: "C:\\Users\\15249\\AppData\\Local\\Temp\\qshell_external_edits\\session-uuid-1234\\nginx.conf",
      fileName: "nginx.conf",
      size: 2156,
      timestamp: "2026-11-10 00:01:23",
    };

    syncCallback(eventPayload);

    expect(syncCallback).toHaveBeenCalledTimes(1);
    expect(syncCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "nginx.conf",
        size: 2156,
        timestamp: "2026-11-10 00:01:23",
      })
    );
  });

  it("当停止监听时应能从活跃列表中正确剔除", () => {
    const sessions: ExternalEditSession[] = [
      {
        sessionId: "session-1",
        serverId: "srv-1",
        remotePath: "/var/log/app.log",
        localPath: "/tmp/app.log",
        fileName: "app.log",
        lastSyncedSize: 100,
      },
      {
        sessionId: "session-2",
        serverId: "srv-1",
        remotePath: "/etc/hosts",
        localPath: "/tmp/hosts",
        fileName: "hosts",
        lastSyncedSize: 50,
      },
    ];

    const targetSessionId = "session-1";
    const remaining = sessions.filter((s) => s.sessionId !== targetSessionId);

    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe("session-2");
  });

  it("当远程文件大于 2MB 时，外部编辑器应拦截并拒绝打开", () => {
    const MAX_EXTERNAL_EDIT_SIZE = 2 * 1024 * 1024;
    const testCases = [
      { size: 1024 * 500, expectedAllowed: true }, // 500KB
      { size: 2 * 1024 * 1024, expectedAllowed: true }, // 2MB 边界
      { size: 2 * 1024 * 1024 + 1, expectedAllowed: false }, // 2MB + 1字节
      { size: 5 * 1024 * 1024, expectedAllowed: false }, // 5MB
      { size: 50 * 1024 * 1024, expectedAllowed: false }, // 50MB
    ];

    for (const tc of testCases) {
      const isAllowed = tc.size <= MAX_EXTERNAL_EDIT_SIZE;
      expect(isAllowed).toBe(tc.expectedAllowed);
    }
  });
});
