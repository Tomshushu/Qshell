import { describe, it, expect } from "vitest";
import { useAppStore } from "@/store";

describe("SFTP 软链接处理策略 (Symlink Policy)", () => {
  it("默认策略应为 skip (跳过软链接)", () => {
    const policy = useAppStore.getState().sftpSymlinkPolicy;
    expect(policy).toBe("skip");
  });

  it("应支持切换为 follow 策略 (跟随并传输真实目标)", () => {
    useAppStore.getState().setSftpSymlinkPolicy("follow");
    expect(useAppStore.getState().sftpSymlinkPolicy).toBe("follow");

    // 切回默认
    useAppStore.getState().setSftpSymlinkPolicy("skip");
    expect(useAppStore.getState().sftpSymlinkPolicy).toBe("skip");
  });
});
