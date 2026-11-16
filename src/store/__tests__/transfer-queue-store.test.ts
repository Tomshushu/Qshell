import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireTransferQueueListeners,
  MAX_TASKS,
  registerTransferMeta,
  useTransferQueueStore,
} from "../transfer-queue-store";

describe("useTransferQueueStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTransferQueueStore.getState().clearAll();
    useTransferQueueStore.getState().setMaxConcurrent(3);
  });

  it("never persists queue state to localStorage", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    useTransferQueueStore.getState().enqueueTask({
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "secret.tar.gz",
      totalBytes: 2048,
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    setItemSpy.mockRestore();
  });

  it("launches queued tasks in priority order (high > normal > low) up to concurrency cap", async () => {
    const order: string[] = [];
    let releaseHigh!: () => void;
    const highGate = new Promise<void>((resolve) => {
      releaseHigh = resolve;
    });

    const store = useTransferQueueStore.getState();
    store.setMaxConcurrent(1);

    store.enqueueTask({
      id: "t-low",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "low.bin",
      totalBytes: 100,
      priority: "low",
      createdAt: 100,
      startFn: async () => {
        order.push("low");
      },
    });
    store.enqueueTask({
      id: "t-normal",
      protocol: "ftp",
      direction: "download",
      serverId: "srv-1",
      fileName: "normal.bin",
      totalBytes: 100,
      priority: "normal",
      createdAt: 200,
      startFn: async () => {
        order.push("normal");
      },
    });
    store.enqueueTask({
      id: "t-high",
      protocol: "scp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "high.bin",
      totalBytes: 100,
      priority: "high",
      createdAt: 300,
      startFn: async () => {
        order.push("high");
        await highGate;
      },
    });

    const launched = store.tickScheduler(1000);
    expect(launched).toEqual(["t-high"]);
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === "t-high")?.status,
    ).toBe("transferring");
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === "t-normal")?.status,
    ).toBe("queued");

    // Finish high-priority task -> automatically schedules normal, then low
    releaseHigh();
    await new Promise((r) => setTimeout(r, 20));

    expect(order).toEqual(["high", "normal", "low"]);
    const tasks = useTransferQueueStore.getState().tasks;
    expect(tasks.every((t) => t.status === "completed")).toBe(true);
  });

  it("promotes scheduled tasks to queued when scheduledAt <= now on tickScheduler", () => {
    const startSpy = vi.fn(async () => {});
    const store = useTransferQueueStore.getState();

    store.enqueueTask({
      id: "t-sched",
      protocol: "sftp",
      direction: "download",
      serverId: "srv-1",
      fileName: "nightly.sql",
      totalBytes: 4096,
      scheduledAt: 5000,
      createdAt: 1000,
      startFn: startSpy,
    });

    // Before due time
    const before = store.tickScheduler(4999);
    expect(before).toEqual([]);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("scheduled");

    // At due time
    const atDue = store.tickScheduler(5000);
    expect(atDue).toEqual(["t-sched"]);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("transferring");
  });

  it("supports rescheduling, priority updates, pause, resume, and cancel", () => {
    const store = useTransferQueueStore.getState();
    store.enqueueTask({
      id: "t-1",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "app.jar",
      totalBytes: 1024,
      createdAt: 100,
    });

    store.setPriority("t-1", "high", 200);
    expect(useTransferQueueStore.getState().tasks[0].priority).toBe("high");

    store.rescheduleTask("t-1", 9000, 200);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("scheduled");
    expect(useTransferQueueStore.getState().tasks[0].scheduledAt).toBe(9000);

    store.pauseTask("t-1", 300);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("paused");

    store.resumeTask("t-1", 400);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("queued");

    store.cancelTask("t-1", 500);
    expect(useTransferQueueStore.getState().tasks[0].status).toBe("cancelled");
  });

  it("aggregates s2s progress events including directory manifests and failures", () => {
    const store = useTransferQueueStore.getState();

    // Directory S2S initial count event
    store.upsertFromProgressEvent(
      {
        transferId: "s2s-dir-1",
        type: "s2s",
        current: 0,
        total: 2,
        fileName: "release",
        totalType: "count",
      },
      {
        sourceServerId: "srv-a",
        targetServerId: "srv-b",
      },
      1000,
    );

    // Child manifest & child byte events must not overwrite parent count total
    store.upsertFromProgressEvent(
      {
        transferId: "s2s-dir-1",
        type: "s2s",
        current: 0,
        total: 5000,
        fileName: "release/a.bin",
        totalType: "manifest",
      },
      undefined,
      1100,
    );
    store.upsertFromProgressEvent(
      {
        transferId: "s2s-dir-1",
        type: "s2s",
        current: 2500,
        total: 5000,
        fileName: "release/a.bin",
        totalType: "bytes",
      },
      undefined,
      1200,
    );

    let task = useTransferQueueStore.getState().tasks.find((t) => t.id === "s2s-dir-1");
    expect(task?.protocol).toBe("s2s");
    expect(task?.direction).toBe("s2s");
    expect(task?.sourceServerId).toBe("srv-a");
    expect(task?.targetServerId).toBe("srv-b");
    expect(task?.totalBytes).toBe(2);
    expect(task?.children?.[0]?.transferredBytes).toBe(2500);

    // Failures event updates child status & counts
    store.applyFailuresEvent(
      {
        transferId: "s2s-dir-1",
        type: "s2s",
        serverId: "srv-a",
        succeeded: 1,
        skipped: 0,
        failures: [{ path: "release/b.bin", error: "Permission denied" }],
      },
      1300,
    );

    // Parent completion event
    store.upsertFromProgressEvent(
      {
        transferId: "s2s-dir-1",
        type: "s2s",
        current: 2,
        total: 2,
        fileName: "release",
        done: true,
        totalType: "count",
      },
      undefined,
      1400,
    );

    task = useTransferQueueStore.getState().tasks.find((t) => t.id === "s2s-dir-1");
    expect(task?.status).toBe("partial");
    expect(task?.succeededCount).toBe(1);
    expect(task?.children?.find((c) => c.path === "release/b.bin")?.status).toBe("failed");
  });

  it("computes speed/eta on byte progress and clears completed vs all cleanly", () => {
    const store = useTransferQueueStore.getState();
    store.upsertFromProgressEvent(
      {
        transferId: "dl-1",
        type: "download",
        current: 0,
        total: 10000,
        fileName: "data.bin",
        totalType: "bytes",
        tmpPath: "/tmp/data.bin.part",
      },
      { serverId: "srv-1" },
      1000,
    );
    store.upsertFromProgressEvent(
      {
        transferId: "dl-1",
        type: "download",
        current: 4000,
        total: 10000,
        fileName: "data.bin",
        totalType: "bytes",
      },
      undefined,
      2000,
    );

    let dl = useTransferQueueStore.getState().tasks.find((t) => t.id === "dl-1");
    expect(dl?.speedBytesPerSec).toBe(4000);
    expect(dl?.etaSeconds).toBe(2); // ceil(6000 / 4000)
    expect(dl?.tmpPath).toBe("/tmp/data.bin.part");

    store.upsertFromProgressEvent(
      {
        transferId: "dl-1",
        type: "download",
        current: 10000,
        total: 10000,
        fileName: "data.bin",
        done: true,
      },
      undefined,
      3000,
    );
    store.enqueueTask({
      id: "ul-failed",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "fail.bin",
      totalBytes: 100,
      status: "failed",
      error: "network error",
    });

    store.clearCompleted();
    expect(useTransferQueueStore.getState().tasks.map((t) => t.id)).toEqual([
      "ul-failed",
    ]);

    store.clearAll();
    expect(useTransferQueueStore.getState().tasks).toEqual([]);
  });

  it("backfills missing metadata on paused/completed tasks and deduplicates rapid identical progress", () => {
    const store = useTransferQueueStore.getState();

    // TransferPanel creates task first without SftpPanel meta
    store.upsertFromProgressEvent(
      {
        transferId: "race-1",
        type: "upload",
        current: 1000,
        total: 4000,
        fileName: "bundle.zip",
        totalType: "bytes",
      },
      undefined,
      1000,
    );

    // Rate update at t=2000
    store.upsertFromProgressEvent(
      {
        transferId: "race-1",
        type: "upload",
        current: 2000,
        total: 4000,
        fileName: "bundle.zip",
        totalType: "bytes",
      },
      undefined,
      2000,
    );
    const speedAfter2000 = useTransferQueueStore
      .getState()
      .tasks.find((t) => t.id === "race-1")?.speedBytesPerSec;
    expect(speedAfter2000).toBe(1000);

    // Rapid identical byte update (<50ms) should keep speed unchanged
    store.upsertFromProgressEvent(
      {
        transferId: "race-1",
        type: "upload",
        current: 2000,
        total: 4000,
        fileName: "bundle.zip",
        totalType: "bytes",
      },
      undefined,
      2010,
    );
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((t) => t.id === "race-1")?.speedBytesPerSec,
    ).toBe(1000);

    // User pauses before SftpPanel flushes meta
    store.pauseTask("race-1", 2100);
    expect(store.isTaskPaused("race-1")).toBe(true);

    // SftpPanel arrives late with metadata on paused task -> backfills missing fields without unpausing
    store.upsertFromProgressEvent(
      {
        transferId: "race-1",
        type: "upload",
        current: 2000,
        total: 4000,
        fileName: "bundle.zip",
        tmpPath: "/remote/.bundle.zip.part",
      },
      {
        protocol: "scp",
        serverId: "srv-99",
        serverName: "Prod-99",
        localPath: "C:/local/bundle.zip",
        remotePath: "/remote/bundle.zip",
      },
      2150,
    );

    const updated = useTransferQueueStore
      .getState()
      .tasks.find((t) => t.id === "race-1");
    expect(updated?.status).toBe("paused");
    expect(updated?.serverId).toBe("srv-99");
    expect(updated?.serverName).toBe("Prod-99");
    expect(updated?.localPath).toBe("C:/local/bundle.zip");
    expect(updated?.remotePath).toBe("/remote/bundle.zip");
    expect(updated?.tmpPath).toBe("/remote/.bundle.zip.part");
    expect(updated?.protocol).toBe("scp");

    store.updateTask("race-1", { status: "transferring", error: undefined });
    expect(store.isTaskPaused("race-1")).toBe(false);
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === "race-1")
        ?.status,
    ).toBe("transferring");

    store.setMaxConcurrent(6);
    store.reset();
    expect(useTransferQueueStore.getState().tasks).toEqual([]);
    expect(useTransferQueueStore.getState().maxConcurrent).toBe(3);
  });

  it("prevents trailing tmpLost from resurrecting paused task and protects dir count from child done=true", () => {
    const store = useTransferQueueStore.getState();

    // 1) 暂停任务收到滞后的 tmpLost 不得自动复活为 transferring
    store.enqueueTask({
      id: "paused-tmp-lost",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "big.iso",
      totalBytes: 10000,
      status: "paused",
    });
    store.upsertFromProgressEvent({
      transferId: "paused-tmp-lost",
      type: "upload",
      current: 0,
      total: 10000,
      fileName: "big.iso",
      phase: "tmpLost",
      totalType: "bytes",
      tmpPath: "/tmp/new-part",
    });
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === "paused-tmp-lost")?.status,
    ).toBe("paused");

    // 2) 目录传输中子文件 done=true 不应覆盖父目录文件总计数
    store.upsertFromProgressEvent({
      transferId: "dir-count-1",
      type: "upload",
      current: 0,
      total: 3,
      fileName: "my-dir",
      totalType: "count",
    });
    store.upsertFromProgressEvent({
      transferId: "dir-count-1",
      type: "upload",
      current: 1048576,
      total: 1048576,
      fileName: "large-child.bin",
      done: true,
      totalType: "bytes",
    });
    const dirTask = useTransferQueueStore
      .getState()
      .tasks.find((t) => t.id === "dir-count-1");
    expect(dirTask?.totalBytes).toBe(3);
    expect(dirTask?.status).toBe("transferring");
    expect(dirTask?.children?.[0]?.status).toBe("completed");
  });

  it("ignores stale run completion after pause + immediate resume", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    let calls = 0;

    const task = useTransferQueueStore.getState().enqueueTask({
      id: "pause-resume-race",
      protocol: "sftp",
      direction: "download",
      serverId: "srv-1",
      fileName: "archive.tar",
      totalBytes: 1000,
      startFn: () =>
        new Promise<void>((resolve) => {
          calls += 1;
          if (calls === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    });

    useTransferQueueStore.getState().tickScheduler();
    await Promise.resolve();
    expect(calls).toBe(1);

    // 暂停后立即恢复，产生第二代运行 token
    useTransferQueueStore.getState().pauseTask(task.id);
    useTransferQueueStore.getState().resumeTask(task.id);
    useTransferQueueStore.getState().tickScheduler();
    await Promise.resolve();
    expect(calls).toBe(2);

    // 旧代运行退出 resolveFirst，不应把当前正在进行的二代任务提前标为 completed
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === task.id)?.status,
    ).toBe("transferring");

    // 二代退出后才真正 completed
    resolveSecond();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      useTransferQueueStore.getState().tasks.find((t) => t.id === task.id)?.status,
    ).toBe("completed");
  });

  it("shares a single ref-counted listener subscription via acquireTransferQueueListeners and merges registerTransferMeta", () => {
    const progressCbs = new Set<(d: any) => void>();
    const failuresCbs = new Set<(d: any) => void>();
    const service = {
      onTransferProgress: vi.fn((cb: (d: any) => void) => {
        progressCbs.add(cb);
        return () => progressCbs.delete(cb);
      }),
      onTransferFailures: vi.fn((cb: (d: any) => void) => {
        failuresCbs.add(cb);
        return () => failuresCbs.delete(cb);
      }),
    };

    const releaseA = acquireTransferQueueListeners(service);
    const releaseB = acquireTransferQueueListeners(service);

    expect(service.onTransferProgress).toHaveBeenCalledTimes(1);
    expect(service.onTransferFailures).toHaveBeenCalledTimes(1);
    expect(progressCbs.size).toBe(1);

    registerTransferMeta("meta-pre-1", {
      serverId: "srv-prod",
      serverName: "Prod",
      localPath: "/local/dir",
      remotePath: "/remote/dir",
      protocol: "sftp",
      isDirectory: true,
      totalType: "files",
      filterSummary: "*.log",
      fileName: "dir",
    });

    for (const cb of progressCbs) {
      cb({
        transferId: "meta-pre-1",
        type: "upload",
        current: 1,
        total: 5,
        fileName: "dir",
        totalType: "count",
      });
    }

    const created = useTransferQueueStore
      .getState()
      .tasks.find((t) => t.id === "meta-pre-1");
    expect(created?.serverId).toBe("srv-prod");
    expect(created?.serverName).toBe("Prod");
    expect(created?.isDirectory).toBe(true);
    expect(created?.totalType).toBe("files");
    expect(created?.filterSummary).toBe("*.log");

    // Merging metadata onto an already-existing task updates it immediately
    registerTransferMeta("meta-pre-1", { serverName: "Prod-Updated" });
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((t) => t.id === "meta-pre-1")?.serverName,
    ).toBe("Prod-Updated");

    // Releasing first consumer keeps subscription alive; releasing second unsubscribes
    releaseA();
    expect(progressCbs.size).toBe(1);
    releaseB();
    releaseB(); // idempotent
    expect(progressCbs.size).toBe(0);
    expect(failuresCbs.size).toBe(0);
  });

  it("broadcasts qshell:transfer-queue-sync on mutations and cleans partial/skipped in clearCompleted", () => {
    const events: Array<{ action: string; taskId?: string; status?: string }> = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent).detail);
    };
    window.addEventListener("qshell:transfer-queue-sync", listener);

    const store = useTransferQueueStore.getState();
    store.enqueueTask({
      id: "sync-1",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "a.bin",
      totalBytes: 100,
      status: "transferring",
    });
    store.enqueueTask({
      id: "partial-1",
      protocol: "sftp",
      direction: "upload",
      serverId: "srv-1",
      fileName: "dir-partial",
      totalBytes: 3,
      status: "partial",
    });
    store.enqueueTask({
      id: "skipped-1",
      protocol: "sftp",
      direction: "download",
      serverId: "srv-1",
      fileName: "skip.bin",
      totalBytes: 10,
      status: "skipped",
    });

    store.pauseTask("sync-1");
    store.resumeTask("sync-1");
    store.cancelTask("sync-1");
    store.removeTask("sync-1");
    store.clearCompleted();

    window.removeEventListener("qshell:transfer-queue-sync", listener);

    expect(events.map((e) => e.action)).toEqual([
      "pause",
      "resume",
      "cancel",
      "remove",
      "clearCompleted",
    ]);
    expect(useTransferQueueStore.getState().tasks).toHaveLength(0);
  });

  it("caps tasks at MAX_TASKS (500) by evicting oldest terminal tasks first and decays stale speeds after 2s", () => {
    const store = useTransferQueueStore.getState();

    // Add 1 active task + 505 completed tasks
    store.enqueueTask({
      id: "active-keep",
      protocol: "sftp",
      direction: "download",
      serverId: "srv-1",
      fileName: "active.bin",
      totalBytes: 10000,
      status: "transferring",
      createdAt: 1,
      updatedAt: 1,
    });
    for (let i = 0; i < MAX_TASKS + 5; i++) {
      store.enqueueTask({
        id: `done-${i}`,
        protocol: "sftp",
        direction: "upload",
        serverId: "srv-1",
        fileName: `f-${i}.bin`,
        totalBytes: 100,
        status: "completed",
        createdAt: 100 + i,
        updatedAt: 100 + i,
      });
    }

    const tasks = useTransferQueueStore.getState().tasks;
    expect(tasks).toHaveLength(MAX_TASKS);
    expect(tasks.some((t) => t.id === "active-keep")).toBe(true);
    expect(tasks.some((t) => t.id === "done-0")).toBe(false);
    expect(tasks.some((t) => t.id === `done-${MAX_TASKS + 4}`)).toBe(true);

    // Speed decay after 2s without progress events
    store.upsertFromProgressEvent(
      {
        transferId: "active-keep",
        type: "download",
        current: 2000,
        total: 10000,
        fileName: "active.bin",
      },
      undefined,
      1000,
    );
    store.upsertFromProgressEvent(
      {
        transferId: "active-keep",
        type: "download",
        current: 6000,
        total: 10000,
        fileName: "active.bin",
      },
      undefined,
      2000,
    );
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((t) => t.id === "active-keep")?.speedBytesPerSec,
    ).toBeGreaterThan(0);

    // 1.5s idle -> still positive; 2.0s idle -> decayed to 0
    store.decayStaleSpeeds(3500);
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((t) => t.id === "active-keep")?.speedBytesPerSec,
    ).toBeGreaterThan(0);

    store.decayStaleSpeeds(4000);
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((t) => t.id === "active-keep")?.speedBytesPerSec,
    ).toBe(0);
  });
});
