import { describe, it, expect } from "vitest";
import {
  hexToBytes,
  bytesToHex,
  computeModbusCrc16,
  computeCrc32,
  computeChecksum,
  appendChecksumToHex,
} from "./serial-checksum";

describe("serial-checksum test suite", () => {
  it("hexToBytes and bytesToHex convert correctly", () => {
    const raw = "01 03 00 00 00 02";
    const bytes = hexToBytes(raw);
    expect(bytes).toEqual(new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x02]));
    expect(bytesToHex(bytes)).toBe("01 03 00 00 00 02");
  });

  it("Modbus CRC-16 LE matches standard vector (01 03 00 00 00 02 -> C4 0B)", () => {
    const bytes = hexToBytes("01 03 00 00 00 02");
    const crc = computeModbusCrc16(bytes);
    expect(crc).toBe(0x0bc4); // Low byte is 0xC4, High byte is 0x0B
    const res = computeChecksum(bytes, "modbus-crc16-le");
    expect(res.hex).toBe("C4 0B");
  });

  it("Modbus CRC-16 BE produces high byte first (0B C4)", () => {
    const bytes = hexToBytes("01 03 00 00 00 02");
    const res = computeChecksum(bytes, "modbus-crc16-be");
    expect(res.hex).toBe("0B C4");
  });

  it("appendChecksumToHex correctly appends Modbus CRC-16 LE", () => {
    const res = appendChecksumToHex("01 03 00 00 00 02", "modbus-crc16-le");
    expect(res.valid).toBe(true);
    expect(res.checksumHex).toBe("C4 0B");
    expect(res.resultHex).toBe("01 03 00 00 00 02 C4 0B");
  });

  it("8-bit Checksum Sum (Sum % 256)", () => {
    // 01 + 02 + 03 = 06
    const res = appendChecksumToHex("01 02 03", "sum8");
    expect(res.checksumHex).toBe("06");
    expect(res.resultHex).toBe("01 02 03 06");
  });

  it("8-bit Checksum 2s complement", () => {
    // 01 + 02 + 03 = 06, 2's complement = ~06 + 1 = 0xFA
    const res = appendChecksumToHex("01 02 03", "sum8-2s-compl");
    expect(res.checksumHex).toBe("FA");
  });

  it("XOR / BCC checksum", () => {
    // 01 ^ 02 ^ 03 = 00
    const res = appendChecksumToHex("01 02 03", "xor8");
    expect(res.checksumHex).toBe("00");
  });

  it("CRC-32 IEEE 802.3 calculates 4-byte CRC", () => {
    const bytes = hexToBytes("01 02 03 04");
    const crc = computeCrc32(bytes);
    expect(typeof crc).toBe("number");
    const res = computeChecksum(bytes, "crc32");
    expect(res.bytes.length).toBe(4);
  });

  it("Handles invalid odd half-bytes safely", () => {
    const res = appendChecksumToHex("01 03 0", "modbus-crc16-le");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("存在奇数半字节");
  });
});
