/**
 * 工业级串口校验算法库
 * 
 * 提供工控、物联网与嵌入式调试最常用的校验算法：
 * 1. Modbus CRC-16 (RTU, Little-Endian & Big-Endian)
 * 2. CRC-16 CCITT / XMODEM / 0xFFFF
 * 3. CRC-32 (IEEE 802.3)
 * 4. 8-bit 累加和 (Sum & 2's Complement)
 * 5. LRC (Modbus ASCII 纵向冗余校验)
 * 6. XOR / BCC (8-bit 异或块校验)
 */

export type SerialChecksumType =
  | "none"
  | "modbus-crc16-le"
  | "modbus-crc16-be"
  | "crc16-ccitt-xmodem"
  | "crc16-ccitt-ffff"
  | "crc32"
  | "sum8"
  | "sum8-2s-compl"
  | "lrc"
  | "xor8";

export interface ChecksumOption {
  type: SerialChecksumType;
  label: string;
  description: string;
  byteLength: number;
}

export const SERIAL_CHECKSUM_OPTIONS: ChecksumOption[] = [
  {
    type: "none",
    label: "无校验",
    description: "不自动追加任何校验码",
    byteLength: 0,
  },
  {
    type: "modbus-crc16-le",
    label: "Modbus CRC-16 (低字节在前)",
    description: "标准 Modbus RTU 协议校验 (Poly 0xA001, Init 0xFFFF, 低位在前)",
    byteLength: 2,
  },
  {
    type: "modbus-crc16-be",
    label: "Modbus CRC-16 (高字节在前)",
    description: "Modbus CRC-16 逆序 (Poly 0xA001, Init 0xFFFF, 高位在前)",
    byteLength: 2,
  },
  {
    type: "crc16-ccitt-xmodem",
    label: "CRC-16 / XMODEM",
    description: "Poly 0x1021, Init 0x0000, 高位在前",
    byteLength: 2,
  },
  {
    type: "crc16-ccitt-ffff",
    label: "CRC-16 / CCITT (0xFFFF)",
    description: "Poly 0x1021, Init 0xFFFF, 高位在前",
    byteLength: 2,
  },
  {
    type: "crc32",
    label: "CRC-32 (IEEE 802.3)",
    description: "标准以太网 / Zip CRC-32 校验 (4 字节)",
    byteLength: 4,
  },
  {
    type: "sum8",
    label: "8-bit 累加和 (Sum)",
    description: "所有字节求和取低 8 位 (Sum % 256)",
    byteLength: 1,
  },
  {
    type: "sum8-2s-compl",
    label: "8-bit 补码求和 (2's Comp)",
    description: "累加和取反加一 ((~Sum + 1) & 0xFF)",
    byteLength: 1,
  },
  {
    type: "lrc",
    label: "LRC (Modbus ASCII)",
    description: "纵向冗余校验码 ((0x100 - (Sum & 0xFF)) & 0xFF)",
    byteLength: 1,
  },
  {
    type: "xor8",
    label: "XOR / BCC (异或校验)",
    description: "所有字节逐个异或求和",
    byteLength: 1,
  },
];

/**
 * 将十六进制字符串转为 Uint8Array 字节数组
 */
export function hexToBytes(hexString: string): Uint8Array {
  const cleanHex = hexString.replace(/[^0-9a-fA-F]/g, "");
  if (cleanHex.length === 0) return new Uint8Array(0);

  // 若为奇数位，前面补 0
  const normalized = cleanHex.length % 2 !== 0 ? "0" + cleanHex : cleanHex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 将字节数组格式化为标准大写十六进制字符串（成对空格分隔）
 */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  const arr = Array.from(bytes);
  return arr.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/**
 * 计算 Modbus CRC-16 (Poly 0xA001, Init 0xFFFF)
 */
export function computeModbusCrc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xffff;
}

/**
 * 计算 CRC-16 CCITT (Poly 0x1021)
 */
export function computeCrc16Ccitt(data: Uint8Array, initVal = 0x0000): number {
  let crc = initVal;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

/**
 * 计算标准 CRC-32 (IEEE 802.3)
 */
export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 1) !== 0) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 计算指定类型的校验字节数组
 */
export function computeChecksum(
  data: Uint8Array,
  type: SerialChecksumType
): { hex: string; bytes: number[] } {
  if (type === "none" || data.length === 0) {
    return { hex: "", bytes: [] };
  }

  switch (type) {
    case "modbus-crc16-le": {
      const crc = computeModbusCrc16(data);
      const low = crc & 0xff;
      const high = (crc >> 8) & 0xff;
      return {
        hex: bytesToHex([low, high]),
        bytes: [low, high],
      };
    }

    case "modbus-crc16-be": {
      const crc = computeModbusCrc16(data);
      const low = crc & 0xff;
      const high = (crc >> 8) & 0xff;
      return {
        hex: bytesToHex([high, low]),
        bytes: [high, low],
      };
    }

    case "crc16-ccitt-xmodem": {
      const crc = computeCrc16Ccitt(data, 0x0000);
      const low = crc & 0xff;
      const high = (crc >> 8) & 0xff;
      return {
        hex: bytesToHex([high, low]),
        bytes: [high, low],
      };
    }

    case "crc16-ccitt-ffff": {
      const crc = computeCrc16Ccitt(data, 0xffff);
      const low = crc & 0xff;
      const high = (crc >> 8) & 0xff;
      return {
        hex: bytesToHex([high, low]),
        bytes: [high, low],
      };
    }

    case "crc32": {
      const crc = computeCrc32(data);
      const b3 = (crc >> 24) & 0xff;
      const b2 = (crc >> 16) & 0xff;
      const b1 = (crc >> 8) & 0xff;
      const b0 = crc & 0xff;
      // 网络字节序 Big-Endian
      return {
        hex: bytesToHex([b3, b2, b1, b0]),
        bytes: [b3, b2, b1, b0],
      };
    }

    case "sum8": {
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum = (sum + data[i]) & 0xff;
      }
      return {
        hex: bytesToHex([sum]),
        bytes: [sum],
      };
    }

    case "sum8-2s-compl": {
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum = (sum + data[i]) & 0xff;
      }
      const compl = (~sum + 1) & 0xff;
      return {
        hex: bytesToHex([compl]),
        bytes: [compl],
      };
    }

    case "lrc": {
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum = (sum + data[i]) & 0xff;
      }
      const lrc = (0x100 - sum) & 0xff;
      return {
        hex: bytesToHex([lrc]),
        bytes: [lrc],
      };
    }

    case "xor8": {
      let xor = 0;
      for (let i = 0; i < data.length; i++) {
        xor ^= data[i];
      }
      return {
        hex: bytesToHex([xor]),
        bytes: [xor],
      };
    }

    default:
      return { hex: "", bytes: [] };
  }
}

/**
 * 将原始 HEX 字符串计算校验码并追加返回
 */
export function appendChecksumToHex(
  rawHexString: string,
  type: SerialChecksumType
): {
  resultHex: string;
  checksumHex: string;
  valid: boolean;
  error?: string;
} {
  const cleanHex = rawHexString.replace(/[^0-9a-fA-F]/g, "");
  if (!cleanHex) {
    return { resultHex: "", checksumHex: "", valid: false, error: "内容为空" };
  }

  if (cleanHex.length % 2 !== 0) {
    return {
      resultHex: rawHexString,
      checksumHex: "",
      valid: false,
      error: "存在奇数半字节",
    };
  }

  if (type === "none") {
    return { resultHex: rawHexString, checksumHex: "", valid: true };
  }

  const bytes = hexToBytes(cleanHex);
  const checksum = computeChecksum(bytes, type);

  const formattedRaw = bytesToHex(bytes);
  const resultHex = `${formattedRaw} ${checksum.hex}`.trim();

  return {
    resultHex,
    checksumHex: checksum.hex,
    valid: true,
  };
}
