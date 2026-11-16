import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  HexViewer,
  formatHexLine,
  decodeAsciiPrintable,
  parseOffsetInput,
  parseHexPattern,
} from "../hex-viewer";

describe("HexViewer helpers", () => {
  it("decodes printable ASCII and masks control/non-ASCII bytes", () => {
    const bytes = new Uint8Array([0x48, 0x69, 0x00, 0x1f, 0x7e, 0x80, 0x21]);
    expect(decodeAsciiPrintable(bytes)).toBe("Hi..~.!");
  });

  it("formats a full 16-byte line and partial trailing line cleanly", () => {
    const full = new Uint8Array(16).map((_, i) => 0x41 + i);
    const formattedFull = formatHexLine(0, full, 16);
    expect(formattedFull.formatted).toBe(
      "00000000  |  41 42 43 44 45 46 47 48   49 4A 4B 4C 4D 4E 4F 50  |  ABCDEFGHIJKLMNOP",
    );

    const partial = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const formattedPartial = formatHexLine(0x20, partial, 16);
    expect(formattedPartial.offsetHex).toBe("00000020");
    expect(formattedPartial.ascii).toBe("....");
    expect(formattedPartial.formatted.startsWith("00000020  |  DE AD BE EF")).toBe(
      true,
    );
  });

  it("parses hex/decimal offsets and hex search patterns", () => {
    expect(parseOffsetInput("0x1a")).toBe(26);
    expect(parseOffsetInput("128")).toBe(128);
    expect(parseOffsetInput("-5")).toBeNull();
    expect(parseOffsetInput("xyz")).toBeNull();

    expect(Array.from(parseHexPattern("4D 5A") ?? [])).toEqual([0x4d, 0x5a]);
    expect(parseHexPattern("4D5")).toBeNull();
  });
});

describe("HexViewer component", () => {
  const origOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const origOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    cleanup();
    if (origOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        origOffsetHeight,
      );
    }
    if (origOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        origOffsetWidth,
      );
    }
    vi.restoreAllMocks();
  });

  it("renders empty state for 0-byte input", () => {
    render(<HexViewer data={new Uint8Array(0)} fileName="empty.bin" />);
    expect(screen.getByText("empty.bin")).not.toBeNull();
    expect(screen.getByText("只读")).not.toBeNull();
    expect(screen.getByText("文件内容为空（0 字节）")).not.toBeNull();
  });

  it("virtualizes large buffers and only renders visible rows", () => {
    const big = new Uint8Array(1024 * 1024); // 1 MB = 65536 rows
    const { container } = render(
      <HexViewer data={big} fileName="large.bin" />,
    );
    const renderedRows = container.querySelectorAll("[data-index]");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(60);
  });

  it("renders in-memory data with virtualized rows and supports ASCII/HEX find + jump + copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const bytes = new Uint8Array(64);
    bytes.set([0x45, 0x4c, 0x46], 32); // "ELF" at offset 0x20

    render(<HexViewer data={bytes} fileName="sample.bin" />);

    expect(screen.getByText("00000000")).not.toBeNull();
    expect(screen.getByText("00000020")).not.toBeNull();

    // Find ASCII "ELF"
    const searchInput = screen.getByLabelText("查找十六进制或ASCII");
    fireEvent.change(searchInput, { target: { value: "ELF" } });
    fireEvent.click(screen.getByLabelText("查找下一个"));

    expect(screen.getByText(/查找结果: 0x00000020/)).not.toBeNull();

    // Jump to offset 0x10 and copy offset
    const jumpInput = screen.getByLabelText("跳转偏移");
    fireEvent.change(jumpInput, { target: { value: "0x10" } });
    fireEvent.click(screen.getByLabelText("执行跳转"));

    fireEvent.click(screen.getByTitle("复制选中偏移"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("0x00000010");
    });
  });

  it("fetches chunked ranges on demand and uses LRU cache", async () => {
    const backing = new Uint8Array(2048);
    backing[0] = 0xca;
    backing[1] = 0xfe;

    const onLoadRange = vi.fn(async (offset: number, len: number) =>
      backing.subarray(offset, offset + len),
    );

    render(
      <HexViewer
        totalSize={2048}
        onLoadRange={onLoadRange}
        pageSize={512}
        maxCachedPages={2}
        fileName="huge.img"
      />,
    );

    await waitFor(() => {
      expect(onLoadRange).toHaveBeenCalled();
      expect(screen.getByText("CA")).not.toBeNull();
      expect(screen.getByText("FE")).not.toBeNull();
    });
  });

  it("wraps around to earlier offsets on the starting page during chunked search and handles empty chunks", async () => {
    const backing = new Uint8Array(1024);
    backing.set([0x4d, 0x5a], 10); // "MZ" at 0x0A on page 0
    backing.set([0x4d, 0x5a], 100); // "MZ" at 0x64 on page 0

    const onLoadRange = vi.fn(async (offset: number, len: number) =>
      backing.subarray(offset, Math.min(backing.length, offset + len)),
    );

    render(
      <HexViewer
        totalSize={1024}
        onLoadRange={onLoadRange}
        pageSize={512}
        fileName="wrap.bin"
      />,
    );

    await waitFor(() => {
      expect(onLoadRange).toHaveBeenCalled();
    });

    const searchInput = screen.getByLabelText("查找十六进制或ASCII");
    const findBtn = screen.getByLabelText("查找下一个");
    fireEvent.change(searchInput, { target: { value: "MZ" } });

    // 1st match: 0x0000000A
    fireEvent.click(findBtn);
    await waitFor(() => {
      expect(screen.getByText(/查找结果: 0x0000000A/)).not.toBeNull();
    });

    // 2nd match: 0x00000064
    fireEvent.click(findBtn);
    await waitFor(() => {
      expect(screen.getByText(/查找结果: 0x00000064/)).not.toBeNull();
    });

    // 3rd search wraps around page 1 back to [0 .. 0x65) on page 0 -> 0x0000000A
    fireEvent.click(findBtn);
    await waitFor(() => {
      expect(screen.getByText(/查找结果: 0x0000000A/)).not.toBeNull();
    });

    // Empty chunk breaks cleanly
    const emptyLoader = vi.fn(async () => new Uint8Array(0));
    cleanup();
    render(
      <HexViewer
        totalSize={1024}
        onLoadRange={emptyLoader}
        pageSize={512}
        fileName="empty-chunk.bin"
      />,
    );
    fireEvent.change(screen.getByLabelText("查找十六进制或ASCII"), {
      target: { value: "ZZ" },
    });
    fireEvent.click(screen.getByLabelText("查找下一个"));
    await waitFor(() => {
      expect(screen.getByText(/查找结果: 未找到匹配/)).not.toBeNull();
    });
  });

  it("displays chunkError with retry button when onLoadRange rejects and recovers on retry", async () => {
    let shouldFail = true;
    const backing = new Uint8Array(512);
    backing[0] = 0xbe;
    backing[1] = 0xef;

    const onLoadRange = vi.fn(async (offset: number, len: number) => {
      if (shouldFail) {
        throw new Error("SFTP read timeout");
      }
      return backing.subarray(offset, offset + len);
    });

    render(
      <HexViewer
        totalSize={512}
        onLoadRange={onLoadRange}
        pageSize={512}
        fileName="flaky.bin"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("SFTP read timeout");
    });

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("BE")).not.toBeNull();
      expect(screen.getByText("EF")).not.toBeNull();
    });
  });

  it("partitions >16M px files into 524,288-row windows and switches window on Jump to Offset", async () => {
    const totalSize = 24 * 1024 * 1024; // 24 MB -> 1,572,864 rows (3 segments)
    const onLoadRange = vi.fn(
      async (_offset: number, len: number) => new Uint8Array(len),
    );

    render(
      <HexViewer
        totalSize={totalSize}
        onLoadRange={onLoadRange}
        pageSize={64 * 1024}
        fileName="big-24mb.bin"
      />,
    );

    expect(screen.getByText(/分段 1\/3/)).not.toBeNull();
    const prevBtn = screen.getByRole("button", { name: "上一分段" });
    const nextBtn = screen.getByRole("button", { name: "下一分段" });
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);
    await waitFor(() => {
      expect(screen.getByText(/分段 2\/3/)).not.toBeNull();
    });

    // Jump to offset in segment 3 (0x1100000 = 17MB > 16MB)
    fireEvent.change(screen.getByLabelText("跳转偏移"), {
      target: { value: "0x1100000" },
    });
    fireEvent.click(screen.getByLabelText("执行跳转"));

    await waitFor(() => {
      expect(screen.getByText(/分段 3\/3/)).not.toBeNull();
    });
  });

  it("awaits ensurePage asynchronously when copying HEX for an uncached chunked row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const backing = new Uint8Array(1024);
    // Row at offset 0x200 (page 1 when pageSize=256)
    backing.set([0xde, 0xad, 0xbe, 0xef], 0x200);

    const onLoadRange = vi.fn(async (offset: number, len: number) =>
      backing.subarray(offset, Math.min(backing.length, offset + len)),
    );

    render(
      <HexViewer
        totalSize={1024}
        onLoadRange={onLoadRange}
        pageSize={256}
        maxCachedPages={1}
        fileName="evicted.bin"
      />,
    );

    await waitFor(() => {
      expect(onLoadRange).toHaveBeenCalled();
    });

    // Jump to offset 0x200 (updates selectedOffset immediately) and copy HEX
    fireEvent.change(screen.getByLabelText("跳转偏移"), {
      target: { value: "0x200" },
    });
    fireEvent.click(screen.getByLabelText("执行跳转"));
    fireEvent.click(screen.getByTitle("复制当前行 HEX"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toMatch(/^DE AD BE EF/);
    });
  });
});
