import { describe, it, expect } from "vitest";
import { parseCronExpression } from "../tools/tool-cron";
import { parseCurlCommand } from "../tools/tool-curl";
import { calculateCidr } from "../tools/tool-cidr";
import { guessBestToolId } from "../tools/tool-registry";
import { calculateMd5 } from "../tools/tool-hash";
import { parseMacAddress } from "../tools/tool-mac";
import { convertRadix, parseToBigInt, formatBinaryBits } from "../tools/tool-radix";

describe("DevTools 运维与开发工具箱核心引擎测试", () => {
  describe("Cron 表达式解析引擎 (tool-cron)", () => {
    it("正确解析标准 5 位 Cron 并生成自然语言与未来执行时间", () => {
      const res = parseCronExpression("0 2 * * *");
      expect(res.valid).toBe(true);
      expect(res.humanText).toContain("02 点");
      expect(res.nextOccurrences.length).toBe(5);
    });

    it("正确解析带步长和星期的复杂 Cron", () => {
      const res = parseCronExpression("*/15 9-18 * * 1-5");
      expect(res.valid).toBe(true);
      expect(res.humanText).toContain("每隔 15 分钟");
      expect(res.humanText).toContain("周一 至 周五");
      expect(res.nextOccurrences.length).toBe(5);
    });

    it("正确拦截非法 Cron 表达式", () => {
      const res = parseCronExpression("60 * * * *"); // 60 分钟超出 0-59
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe("cURL 结构化拆解引擎 (tool-curl)", () => {
    it("正确拆解带请求头和 JSON Body 的 POST 请求", () => {
      const cmd = `curl -X POST "https://api.example.com/v1/orders?trace=1" -H "Authorization: Bearer token123" -H "Content-Type: application/json" -d '{"orderId":"1001","amount":99.5}'`;
      const res = parseCurlCommand(cmd);
      expect(res.valid).toBe(true);
      expect(res.method).toBe("POST");
      expect(res.urlBase).toBe("https://api.example.com/v1/orders");
      expect(res.queryParams).toEqual([{ key: "trace", value: "1" }]);
      expect(res.headers.length).toBe(2);
      expect(res.headers.find((h) => h.key === "Content-Type")?.value).toBe("application/json");
      expect(res.bodyType).toBe("json");
      expect(res.pythonSnippet).toContain("import requests");
      expect(res.nodeSnippet).toContain("await fetch");
    });

    it("正确处理换行续行符 \\", () => {
      const cmd = `curl "https://example.com" \\\n  -H "X-Custom: test"`;
      const res = parseCurlCommand(cmd);
      expect(res.valid).toBe(true);
      expect(res.urlBase).toBe("https://example.com");
      expect(res.headers[0].key).toBe("X-Custom");
    });
  });

  describe("IP / CIDR 网段计算器 (tool-cidr)", () => {
    it("正确计算 Class C (/24) 网段参数", () => {
      const res = calculateCidr("192.168.1.100/24");
      expect(res.valid).toBe(true);
      expect(res.networkAddress).toBe("192.168.1.0");
      expect(res.netmask).toBe("255.255.255.0");
      expect(res.broadcastAddress).toBe("192.168.1.255");
      expect(res.firstUsableIp).toBe("192.168.1.1");
      expect(res.lastUsableIp).toBe("192.168.1.254");
      expect(res.usableHosts).toBe(254);
      expect(res.ipType).toContain("私有网络");
    });

    it("正确计算 Class B (/16) 网段参数", () => {
      const res = calculateCidr("10.50.0.1/16");
      expect(res.valid).toBe(true);
      expect(res.networkAddress).toBe("10.50.0.0");
      expect(res.netmask).toBe("255.255.0.0");
      expect(res.usableHosts).toBe(65534);
    });

    it("正确拦截非法 IP 格式", () => {
      const res = calculateCidr("999.1.1.1/24");
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe("MD5 哈希计算引擎 (tool-hash)", () => {
    it("正确计算标准 MD5", () => {
      expect(calculateMd5("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
      expect(calculateMd5("123456")).toBe("e10adc3949ba59abbe56e057f20f883e");
    });
  });

  describe("终端选中文本智能路由推导 (guessBestToolId)", () => {
    it("智能识别 JWT Token 路由到 jwt", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      expect(guessBestToolId(jwt)).toBe("jwt");
    });

    it("智能识别 cURL 命令路由到 curl", () => {
      expect(guessBestToolId("curl https://api.com -H 'X: 1'")).toBe("curl");
      expect(guessBestToolId("$ curl -X POST https://api.com")).toBe("curl");
    });

    it("智能识别纯时间戳路由到 timestamp", () => {
      expect(guessBestToolId("1730372400")).toBe("timestamp");
      expect(guessBestToolId("1730372400000")).toBe("timestamp");
    });

    it("智能识别 CIDR 路由到 cidr", () => {
      expect(guessBestToolId("192.168.1.1/24")).toBe("cidr");
    });

    it("智能识别 Cron 表达式路由到 cron", () => {
      expect(guessBestToolId("*/5 * * * *")).toBe("cron");
    });

    it("智能识别纯 JSON 对象路由到 json", () => {
      expect(guessBestToolId('{"code":200,"message":"ok"}')).toBe("json");
    });

    it("智能识别 MAC 地址路由到 mac", () => {
      expect(guessBestToolId("00:1E:67:8A:9B:CD")).toBe("mac");
      expect(guessBestToolId("00-1E-67-8A-9B-CD")).toBe("mac");
      expect(guessBestToolId("001e.678a.9bcd")).toBe("mac");
    });

    it("智能识别进制前缀与普通数字路由到 radix", () => {
      expect(guessBestToolId("0xCAFE")).toBe("radix");
      expect(guessBestToolId("0b10110011")).toBe("radix");
      expect(guessBestToolId("0o777")).toBe("radix");
      expect(guessBestToolId("65535")).toBe("radix");
      expect(guessBestToolId("DEADBEEF")).toBe("radix");
    });

    it("无特征文本默认回退到常用工作台 json", () => {
      expect(guessBestToolId("some random text")).toBe("json");
      expect(guessBestToolId("")).toBe("json");
    });
  });

  describe("MAC 地址与大小端格式化转换引擎 (tool-mac)", () => {
    it("正确解析标准 MAC 并支持大小端翻转与去除冒号", () => {
      const mac = "00:1A:2B:3C:4D:5E";
      const res = parseMacAddress(mac, true);

      expect(res.valid).toBe(true);
      // 大端序测试
      expect(res.bigEndian.colon).toBe("00:1A:2B:3C:4D:5E");
      expect(res.bigEndian.hyphen).toBe("00-1A-2B-3C-4D-5E");
      expect(res.bigEndian.dot).toBe("001A.2B3C.4D5E");
      expect(res.bigEndian.none).toBe("001A2B3C4D5E"); // 去除冒号

      // 小端序字节翻转测试 (低字节在前)
      expect(res.littleEndian.colon).toBe("5E:4D:3C:2B:1A:00");
      expect(res.littleEndian.none).toBe("5E4D3C2B1A00"); // 小端去除冒号
    });

    it("正确支持大小写转换", () => {
      const mac = "00:1a:2b:3c:4d:5e";
      const upperRes = parseMacAddress(mac, true);
      const lowerRes = parseMacAddress(mac, false);

      expect(upperRes.bigEndian.colon).toBe("00:1A:2B:3C:4D:5E");
      expect(upperRes.bigEndian.none).toBe("001A2B3C4D5E");

      expect(lowerRes.bigEndian.colon).toBe("00:1a:2b:3c:4d:5e");
      expect(lowerRes.bigEndian.none).toBe("001a2b3c4d5e");
    });

    it("正确容错多种输入形式 (点分、无符号、短横线)", () => {
      const r1 = parseMacAddress("001a.2b3c.4d5e");
      const r2 = parseMacAddress("001A2B3C4D5E");
      const r3 = parseMacAddress("00-1A-2B-3C-4D-5E");

      expect(r1.valid).toBe(true);
      expect(r2.valid).toBe(true);
      expect(r3.valid).toBe(true);
      expect(r1.bigEndian.colon).toBe("00:1A:2B:3C:4D:5E");
      expect(r2.bigEndian.colon).toBe("00:1A:2B:3C:4D:5E");
      expect(r3.bigEndian.colon).toBe("00:1A:2B:3C:4D:5E");
    });

    it("正确判定单播/组播与本地/全球管理属性", () => {
      const multicast = parseMacAddress("01:00:5e:00:00:01");
      expect(multicast.properties.isMulticast).toBe(true);

      const docker = parseMacAddress("02:42:ac:11:00:02");
      expect(docker.properties.isLocalAdmin).toBe(true);
      expect(docker.properties.vendorName).toContain("Docker");
    });
  });

  describe("进制转换与整数大小端引擎 (tool-radix)", () => {
    it("正确进行 10 进制向 16、2、8 进制的全双向同步转换", () => {
      const res = convertRadix("1024");
      expect(res.valid).toBe(true);
      expect(res.decimal).toBe("1024");
      expect(res.hexUpper).toBe("0x400");
      expect(res.hexLower).toBe("0x400");
      expect(res.octal).toBe("0o2000");
      expect(res.binaryRaw).toBe("0b10000000000");
      expect(res.binaryFormatted).toBe("100 0000 0000");
      expect(res.bitLength).toBe(11);
    });

    it("正确支持 4 位二进制分组格式化", () => {
      expect(formatBinaryBits("111100001010")).toBe("1111 0000 1010");
      expect(formatBinaryBits("1010")).toBe("1010");
      expect(formatBinaryBits("1")).toBe("1");
    });

    it("正确识别与映射 ASCII 可打印字符范围 (32~126)", () => {
      const resA = convertRadix("65");
      expect(resA.valid).toBe(true);
      expect(resA.asciiChar).toBe("A");

      const resSpace = convertRadix("32");
      expect(resSpace.valid).toBe(true);
      expect(resSpace.asciiChar).toBe(" ");

      const resOut = convertRadix("127");
      expect(resOut.asciiChar).toBeUndefined();
    });

    it("正确计算 16 位和 32 位整数的大端与小端字节序翻转", () => {
      // 0x1234: 16位大端 0x1234, 16位小端 0x3412
      const res16 = convertRadix("0x1234");
      expect(res16.valid).toBe(true);
      expect(res16.endian16).toBeDefined();
      expect(res16.endian16?.be).toBe("0x1234");
      expect(res16.endian16?.le).toBe("0x3412");

      // 0x12345678: 32位大端 0x12345678, 32位小端 0x78563412
      const res32 = convertRadix("0x12345678");
      expect(res32.valid).toBe(true);
      expect(res32.endian32?.be).toBe("0x12345678");
      expect(res32.endian32?.le).toBe("0x78563412");
    });

    it("支持 ES2020 BigInt 超大整数转换无精度丢失", () => {
      const huge = "18446744073709551616"; // 2^64
      const res = convertRadix(huge);
      expect(res.valid).toBe(true);
      expect(res.decimal).toBe(huge);
      expect(res.hexUpper).toBe("0x10000000000000000");
    });

    it("正确支持指定输入进制", () => {
      const bi16 = parseToBigInt("DEADBEEF", 16);
      expect(bi16).toBe(3735928559n);

      const bi2 = parseToBigInt("1100 1010", 2);
      expect(bi2).toBe(202n);
    });
  });
});
