import { describe, it, expect, vi } from "vitest";
import {
  buildBinaryDiffRow,
  compareBinaryBuffers,
  compareChunkedBinarySources,
  paginateBinaryDiffRows,
  scanBinaryBuffersSummary,
  type ChunkedBinarySource,
} from "../binary-diff";

describe("binary-diff engine", () => {
  it("handles empty buffers cleanly", async () => {
    const res = await compareBinaryBuffers(new Uint8Array(0), new Uint8Array(0));
    expect(res.rows).toEqual([]);
    expect(res.totalRows).toBe(0);
    expect(res.stats).toEqual({
      equalBytes: 0,
      diffBytes: 0,
      totalLeft: 0,
      totalRight: 0,
      diffOffsetList: [],
    });
  });

  it("identifies equal, modified, added, and removed rows with byte masks", async () => {
    // 24 bytes left, 40 bytes right:
    // Row 0 (0..15): equal
    // Row 1 (16..23 vs 16..31): left has 8 bytes (2 modified at 18, 20), right has 16 bytes (8 added 24..31)
    // Row 2 (32..39): added (only in right)
    const left = new Uint8Array(24);
    const right = new Uint8Array(40);
    for (let i = 0; i < 24; i++) {
      left[i] = i;
      right[i] = i;
    }
    for (let i = 24; i < 40; i++) {
      right[i] = i;
    }
    right[18] = 0xff;
    right[20] = 0xaa;

    const res = await compareBinaryBuffers(left, right, { bytesPerRow: 16 });
    expect(res.totalRows).toBe(3);
    expect(res.rows[0].kind).toBe("equal");
    expect(res.rows[0].changedMask.every((v) => !v)).toBe(true);

    expect(res.rows[1].kind).toBe("modified");
    expect(res.rows[1].offset).toBe(16);
    expect(res.rows[1].changedMask[2]).toBe(true); // offset 18
    expect(res.rows[1].changedMask[4]).toBe(true); // offset 20
    expect(res.rows[1].changedMask[8]).toBe(true); // offset 24 (beyond left)

    expect(res.rows[2].kind).toBe("added");
    expect(res.rows[2].offset).toBe(32);
    expect(res.rows[2].leftBytes.length).toBe(0);
    expect(res.rows[2].rightBytes.length).toBe(8);

    expect(res.stats.totalLeft).toBe(24);
    expect(res.stats.totalRight).toBe(40);
    expect(res.stats.equalBytes).toBe(22);
    expect(res.stats.diffBytes).toBe(18); // 2 modified + 16 extra right bytes
    expect(res.stats.diffOffsetList.slice(0, 3)).toEqual([18, 20, 24]);

    // Reverse comparison produces 'removed' for trailing left bytes
    const rev = await compareBinaryBuffers(right, left, { bytesPerRow: 16 });
    expect(rev.rows[2].kind).toBe("removed");
  });

  it("supports chunked sources, yielding across chunks, and pagination", async () => {
    const dataL = new Uint8Array(256).map((_, i) => i & 0xff);
    const dataR = new Uint8Array(256).map((_, i) => i & 0xff);
    dataR[5] = 0x99;
    dataR[130] = 0x77;

    const readLeft = vi.fn(async (offset: number, len: number) =>
      dataL.subarray(offset, offset + len),
    );
    const readRight = vi.fn(async (offset: number, len: number) =>
      dataR.subarray(offset, offset + len),
    );

    const srcL: ChunkedBinarySource = {
      totalSize: dataL.length,
      readRange: readLeft,
    };
    const srcR: ChunkedBinarySource = {
      totalSize: dataR.length,
      readRange: readRight,
    };

    const progressUpdates: number[] = [];
    const res = await compareChunkedBinarySources(srcL, srcR, {
      bytesPerRow: 16,
      chunkSize: 64,
      yieldEveryChunks: 1,
      page: 1,
      pageSize: 4,
      onProgress: (done) => progressUpdates.push(done),
    });

    expect(readLeft).toHaveBeenCalledTimes(4);
    expect(readRight).toHaveBeenCalledTimes(4);
    expect(progressUpdates).toEqual([64, 128, 192, 256]);
    expect(res.totalRows).toBe(16);
    expect(res.totalPages).toBe(4);
    expect(res.page).toBe(1);
    expect(res.rows).toHaveLength(4);
    expect(res.rows[0].offset).toBe(64);
    expect(res.stats.diffOffsetList).toEqual([5, 130]);
  });

  it("filters onlyChangedRows and paginates existing rows", async () => {
    const a = new Uint8Array(64);
    const b = new Uint8Array(64);
    b[35] = 1;

    const full = await compareBinaryBuffers(a, b, {
      bytesPerRow: 16,
      onlyChangedRows: true,
    });
    expect(full.rows).toHaveLength(1);
    expect(full.rows[0].offset).toBe(32);

    const all = await compareBinaryBuffers(a, b, { bytesPerRow: 16 });
    const paged = paginateBinaryDiffRows(all.rows, 1, 2);
    expect(paged.totalRows).toBe(4);
    expect(paged.totalPages).toBe(2);
    expect(paged.rows.map((r) => r.offset)).toEqual([32, 48]);
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      compareBinaryBuffers(new Uint8Array(32), new Uint8Array(32), {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("scans summary without row allocation and lazily builds individual page rows", async () => {
    const left = new Uint8Array(1024);
    const right = new Uint8Array(1040);
    for (let i = 0; i < 1024; i++) {
      left[i] = i & 0xff;
      right[i] = i & 0xff;
    }
    right[33] = 0xee;
    right[512] = 0xdd;

    const summary = await scanBinaryBuffersSummary(left, right, { bytesPerRow: 16 });
    expect(summary.totalLeft).toBe(1024);
    expect(summary.totalRight).toBe(1040);
    expect(summary.totalRows).toBe(65);
    expect(summary.changedRowIndices).toEqual([2, 32, 64]);
    expect(summary.diffBytes).toBe(18);
    expect(summary.equalBytes).toBe(1022);

    const row2 = buildBinaryDiffRow(left, right, 2, 16, 0x100000);
    expect(row2.offset).toBe(0x100020);
    expect(row2.kind).toBe("modified");
    expect(row2.changedMask[1]).toBe(true);

    const row64 = buildBinaryDiffRow(left, right, 64, 16, 0x100000);
    expect(row64.kind).toBe("added");
    expect(row64.leftBytes.length).toBe(0);
    expect(row64.rightBytes.length).toBe(16);
  });
});
