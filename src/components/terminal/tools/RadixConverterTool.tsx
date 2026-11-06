import { useState, useMemo, useEffect } from "react";
import {
  Copy,
  Check,
  Binary,
  ClipboardPaste,
  Hash,
  ArrowLeftRight,
  Code2,
  Layers,
  HelpCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  convertRadix,
  parseToBigInt,
  formatBinaryBits,
  type RadixConvertResult,
} from "./tool-radix";

interface RadixConverterToolProps {
  initialSeed?: string;
  initialText?: string;
}

const PRESETS = [
  { label: "0", val: "0" },
  { label: "255 (0xFF)", val: "255" },
  { label: "1024", val: "1024" },
  { label: "65535 (16位)", val: "65535" },
  { label: "0x7FFFFFFF (32位有符号)", val: "2147483647" },
  { label: "0xFFFFFFFF (32位无符号)", val: "4294967295" },
  { label: "0xDEADBEEF", val: "0xDEADBEEF" },
];

export function RadixConverterTool({
  initialSeed,
  initialText,
}: RadixConverterToolProps) {
  const seed = (initialSeed || initialText || "1024").trim();

  // 内部维护一个统一的 BigInt 数值字符串（以十进制为基准同步）
  const [decInput, setDecInput] = useState("");
  const [hexInput, setHexInput] = useState("");
  const [binInput, setBinInput] = useState("");
  const [octInput, setOctInput] = useState("");

  const [includePrefix, setIncludePrefix] = useState(true);
  const [isUppercaseHex, setIsUppercaseHex] = useState(true);
  const [groupBinaryBits, setGroupBinaryBits] = useState(true);
  const [activeBase, setActiveBase] = useState<number>(10);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 初始化根据 seed 计算
  useEffect(() => {
    const s = seed.trim();
    if (!s) return;
    const res = convertRadix(s);
    if (res.valid && res.bigIntValue !== null) {
      updateAllFromBigInt(res.bigIntValue);
    } else {
      setDecInput(s);
    }
  }, [seed]);

  const updateAllFromBigInt = (bi: bigint) => {
    const isNeg = bi < 0n;
    const absBi = isNeg ? -bi : bi;

    const dec = bi.toString(10);
    const hex = isUppercaseHex
      ? absBi.toString(16).toUpperCase()
      : absBi.toString(16).toLowerCase();
    const bin = absBi.toString(2);
    const oct = absBi.toString(8);

    setDecInput(dec);
    setHexInput(
      isNeg
        ? `-0x${hex}`
        : includePrefix
          ? `0x${hex}`
          : hex,
    );
    setBinInput(
      isNeg
        ? `-0b${bin}`
        : includePrefix
          ? `0b${groupBinaryBits ? formatBinaryBits(bin) : bin}`
          : groupBinaryBits
            ? formatBinaryBits(bin)
            : bin,
    );
    setOctInput(
      isNeg
        ? `-0o${oct}`
        : includePrefix
          ? `0o${oct}`
          : oct,
    );
  };

  // 根据当前 Dec 输入计算主结果
  const result: RadixConvertResult = useMemo(() => {
    return convertRadix(decInput, 10);
  }, [decInput]);

  const handleDecChange = (val: string) => {
    setDecInput(val);
    setActiveBase(10);
    const bi = parseToBigInt(val, 10);
    if (bi !== null) {
      const isNeg = bi < 0n;
      const absBi = isNeg ? -bi : bi;
      const hex = isUppercaseHex
        ? absBi.toString(16).toUpperCase()
        : absBi.toString(16).toLowerCase();
      const bin = absBi.toString(2);
      const oct = absBi.toString(8);

      setHexInput(
        isNeg
          ? `-0x${hex}`
          : includePrefix
            ? `0x${hex}`
            : hex,
      );
      setBinInput(
        isNeg
          ? `-0b${bin}`
          : includePrefix
            ? `0b${groupBinaryBits ? formatBinaryBits(bin) : bin}`
            : groupBinaryBits
              ? formatBinaryBits(bin)
              : bin,
      );
      setOctInput(
        isNeg
          ? `-0o${oct}`
          : includePrefix
            ? `0o${oct}`
            : oct,
      );
    }
  };

  const handleHexChange = (val: string) => {
    setHexInput(val);
    setActiveBase(16);
    const bi = parseToBigInt(val, 16);
    if (bi !== null) {
      const isNeg = bi < 0n;
      const absBi = isNeg ? -bi : bi;
      setDecInput(bi.toString(10));
      const bin = absBi.toString(2);
      const oct = absBi.toString(8);
      setBinInput(
        isNeg
          ? `-0b${bin}`
          : includePrefix
            ? `0b${groupBinaryBits ? formatBinaryBits(bin) : bin}`
            : groupBinaryBits
              ? formatBinaryBits(bin)
              : bin,
      );
      setOctInput(
        isNeg
          ? `-0o${oct}`
          : includePrefix
            ? `0o${oct}`
            : oct,
      );
    }
  };

  const handleBinChange = (val: string) => {
    setBinInput(val);
    setActiveBase(2);
    const bi = parseToBigInt(val, 2);
    if (bi !== null) {
      const isNeg = bi < 0n;
      const absBi = isNeg ? -bi : bi;
      setDecInput(bi.toString(10));
      const hex = isUppercaseHex
        ? absBi.toString(16).toUpperCase()
        : absBi.toString(16).toLowerCase();
      const oct = absBi.toString(8);
      setHexInput(
        isNeg
          ? `-0x${hex}`
          : includePrefix
            ? `0x${hex}`
            : hex,
      );
      setOctInput(
        isNeg
          ? `-0o${oct}`
          : includePrefix
            ? `0o${oct}`
            : oct,
      );
    }
  };

  const handleOctChange = (val: string) => {
    setOctInput(val);
    setActiveBase(8);
    const bi = parseToBigInt(val, 8);
    if (bi !== null) {
      const isNeg = bi < 0n;
      const absBi = isNeg ? -bi : bi;
      setDecInput(bi.toString(10));
      const hex = isUppercaseHex
        ? absBi.toString(16).toUpperCase()
        : absBi.toString(16).toLowerCase();
      const bin = absBi.toString(2);
      setHexInput(
        isNeg
          ? `-0x${hex}`
          : includePrefix
            ? `0x${hex}`
            : hex,
      );
      setBinInput(
        isNeg
          ? `-0b${bin}`
          : includePrefix
            ? `0b${groupBinaryBits ? formatBinaryBits(bin) : bin}`
            : groupBinaryBits
              ? formatBinaryBits(bin)
              : bin,
      );
    }
  };

  const applyPreset = (v: string) => {
    const res = convertRadix(v);
    if (res.valid && res.bigIntValue !== null) {
      updateAllFromBigInt(res.bigIntValue);
    }
  };

  const copyText = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const res = convertRadix(text.trim());
        if (res.valid && res.bigIntValue !== null) {
          updateAllFromBigInt(res.bigIntValue);
        } else {
          setDecInput(text.trim());
        }
      }
    } catch {
      /* ignore */
    }
  };

  const handleClear = () => {
    setDecInput("");
    setHexInput("");
    setBinInput("");
    setOctInput("");
  };

  // 判断整数适配大小
  const getIntCapacityBadge = (bi: bigint | null) => {
    if (bi === null) return null;
    if (bi < 0n) {
      if (bi >= -128n && bi <= 127n) return "int8 (8位有符号)";
      if (bi >= -32768n && bi <= 32767n) return "int16 (16位有符号)";
      if (bi >= -2147483648n && bi <= 2147483647n) return "int32 (32位有符号)";
      if (bi >= -9223372036854775808n && bi <= 9223372036854775807n)
        return "int64 (64位有符号)";
      return "BigInt (>64位)";
    }
    if (bi <= 255n) return "uint8 (8位无符号)";
    if (bi <= 65535n) return "uint16 (16位无符号)";
    if (bi <= 4294967295n) return "uint32 (32位无符号)";
    if (bi <= 18446744073709551615n) return "uint64 (64位无符号)";
    return "BigInt (>64位)";
  };

  return (
    <div className="space-y-4 p-4 text-[13px]">
      {/* 预设与控制工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">
            常用预设:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.val)}
              className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors font-mono"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* 前缀开关 */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 border-border/60"
            onClick={() => {
              setIncludePrefix((prev) => !prev);
              if (result.valid && result.bigIntValue !== null) {
                setTimeout(() => updateAllFromBigInt(result.bigIntValue!), 0);
              }
            }}
            title="是否携带 0x / 0b / 0o 进制前缀"
          >
            <Code2 className="h-3 w-3 text-sky-400" />
            {includePrefix ? "携带前缀 (0x/0b)" : "纯数字无前缀"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 border-border/60"
            onClick={handlePaste}
          >
            <ClipboardPaste className="h-3 w-3 text-emerald-400" />
            从剪贴板粘贴
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={handleClear}
          >
            清空
          </Button>
        </div>
      </div>

      {/* 四大核心进制输入区 (任意输入框均可直接编辑，双向同步) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* 1. 十进制 (Decimal) */}
        <div
          className={`rounded-xl border p-3.5 space-y-2 transition-all ${
            activeBase === 10
              ? "border-sky-500/60 bg-sky-500/[0.03] shadow-sm"
              : "border-border/60 bg-card/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-sky-400" /> 十进制 (Decimal - 10进制)
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => copyText(decInput, "dec")}
            >
              {copiedKey === "dec" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" /> 已复制
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> 复制
                </>
              )}
            </Button>
          </div>
          <Input
            value={decInput}
            onChange={(e) => handleDecChange(e.target.value)}
            placeholder="例如: 1024, -255"
            className="font-mono text-sm tracking-wide bg-background/80"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
            <span>基数: 10 (0~9)</span>
            {result.bigIntValue !== null && (
              <span className="text-emerald-500 font-medium">
                {getIntCapacityBadge(result.bigIntValue)}
              </span>
            )}
          </div>
        </div>

        {/* 2. 十六进制 (Hexadecimal) */}
        <div
          className={`rounded-xl border p-3.5 space-y-2 transition-all ${
            activeBase === 16
              ? "border-sky-500/60 bg-sky-500/[0.03] shadow-sm"
              : "border-border/60 bg-card/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5 text-purple-400" /> 十六进制 (Hex - 16进制)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIsUppercaseHex((u) => !u);
                  if (result.valid && result.bigIntValue !== null) {
                    setTimeout(() => updateAllFromBigInt(result.bigIntValue!), 0);
                  }
                }}
                title="切换十六进制大写或小写"
              >
                {isUppercaseHex ? "大写 (A-F)" : "小写 (a-f)"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => copyText(hexInput, "hex")}
              >
                {copiedKey === "hex" ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> 复制
                  </>
                )}
              </Button>
            </div>
          </div>
          <Input
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value)}
            placeholder="例如: 0x400, 0xFF, DEADBEEF"
            className="font-mono text-sm tracking-wide bg-background/80"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
            <span>基数: 16 (0~9, A~F)</span>
            <span>字节数: {result.valid ? Math.ceil(result.bitLength / 8) : 0} 字节</span>
          </div>
        </div>

        {/* 3. 二进制 (Binary) */}
        <div
          className={`rounded-xl border p-3.5 space-y-2 transition-all ${
            activeBase === 2
              ? "border-sky-500/60 bg-sky-500/[0.03] shadow-sm"
              : "border-border/60 bg-card/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Binary className="h-3.5 w-3.5 text-emerald-400" /> 二进制 (Binary - 2进制)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setGroupBinaryBits((g) => !g);
                  if (result.valid && result.bigIntValue !== null) {
                    setTimeout(() => updateAllFromBigInt(result.bigIntValue!), 0);
                  }
                }}
                title="是否按每 4 位空格美化分段"
              >
                {groupBinaryBits ? "4位分段" : "紧凑无空"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => copyText(binInput, "bin")}
              >
                {copiedKey === "bin" ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> 复制
                  </>
                )}
              </Button>
            </div>
          </div>
          <Input
            value={binInput}
            onChange={(e) => handleBinChange(e.target.value)}
            placeholder="例如: 0b10000000000, 1111 0000"
            className="font-mono text-sm tracking-wide bg-background/80"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
            <span>基数: 2 (0, 1)</span>
            <span>有效位宽: {result.bitLength} bits</span>
          </div>
        </div>

        {/* 4. 八进制 (Octal) */}
        <div
          className={`rounded-xl border p-3.5 space-y-2 transition-all ${
            activeBase === 8
              ? "border-sky-500/60 bg-sky-500/[0.03] shadow-sm"
              : "border-border/60 bg-card/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-amber-400" /> 八进制 (Octal - 8进制)
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => copyText(octInput, "oct")}
            >
              {copiedKey === "oct" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" /> 已复制
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> 复制
                </>
              )}
            </Button>
          </div>
          <Input
            value={octInput}
            onChange={(e) => handleOctChange(e.target.value)}
            placeholder="例如: 0o2000, 755"
            className="font-mono text-sm tracking-wide bg-background/80"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
            <span>基数: 8 (0~7)</span>
            <span>Linux 文件权限/八进制常用</span>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {!result.valid && decInput.trim().length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-destructive text-[11.5px]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{result.error || "当前输入的数值格式有误，无法完成进制解析"}</span>
        </div>
      )}

      {/* 字符与拓展属性卡片 (ASCII 字符映射 & 整数大小端翻转) */}
      {result.valid && result.bigIntValue !== null && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* ASCII 字符预览 */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-medium flex items-center gap-1 text-foreground">
                <Code2 className="h-3.5 w-3.5 text-sky-400" /> ASCII 可打印字符
              </span>
              {result.asciiChar && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  ASCII 范围内
                </span>
              )}
            </div>
            {result.asciiChar ? (
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-2xl font-bold text-sky-400 px-2 py-0.5 bg-sky-500/10 rounded-lg">
                  {result.asciiChar}
                </span>
                <span className="text-muted-foreground font-mono text-[11px]">
                  字符代码: {result.decimal} (0x{result.bigIntValue.toString(16).toUpperCase()})
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground pt-1.5">
                当前数值 (
                {result.bigIntValue < 0n
                  ? "负数"
                  : result.bigIntValue < 32n
                    ? "控制字符 < 32"
                    : "> 126 非标准 ASCII"}
                ) 不在 32~126 可见 ASCII 打印范围内
              </p>
            )}
          </div>

          {/* 16位与32位 大小端字节序翻转 */}
          <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-medium flex items-center gap-1 text-foreground">
                <ArrowLeftRight className="h-3.5 w-3.5 text-purple-400" /> 整数大小端字节序 (Endianness)
              </span>
              <span className="text-[10px] text-muted-foreground">网络字节序 (BE) ↔ 主机字节序 (LE)</span>
            </div>

            {result.endian16 && result.endian32 ? (
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                {/* 16位 */}
                <div className="rounded-lg bg-muted/40 p-2 space-y-1 border border-border/40">
                  <div className="text-[10px] text-muted-foreground font-sans font-medium">
                    16-bit 整数 (Uint16):
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">大端 (BE):</span>
                    <span className="text-foreground font-bold">{result.endian16.be}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">小端 (LE):</span>
                    <button
                      type="button"
                      onClick={() => copyText(result.endian16!.le, "e16")}
                      className="text-purple-400 font-bold hover:underline flex items-center gap-1"
                    >
                      {result.endian16.le}
                      {copiedKey === "e16" ? (
                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* 32位 */}
                <div className="rounded-lg bg-muted/40 p-2 space-y-1 border border-border/40">
                  <div className="text-[10px] text-muted-foreground font-sans font-medium">
                    32-bit 整数 (Uint32):
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">大端 (BE):</span>
                    <span className="text-foreground font-bold">{result.endian32.be}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">小端 (LE):</span>
                    <button
                      type="button"
                      onClick={() => copyText(result.endian32!.le, "e32")}
                      className="text-purple-400 font-bold hover:underline flex items-center gap-1"
                    >
                      {result.endian32.le}
                      {copiedKey === "e32" ? (
                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground pt-1.5">
                负数暂不计算常规无符号整数大小端字节序
              </p>
            )}
          </div>
        </div>
      )}

      {/* 说明栏 */}
      <div className="rounded-xl border border-border/40 bg-muted/20 p-3 text-muted-foreground text-[11px] space-y-1 leading-relaxed">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <HelpCircle className="h-3.5 w-3.5 text-sky-400" />
          <span>进制与大小端使用技巧</span>
        </div>
        <p>
          • <strong>全双向同步</strong>：十进制、十六进制、二进制或八进制均可任意输入修改，系统实时自动解析并计算其余三项。
        </p>
        <p>
          • <strong>超大整数支持</strong>：底层基于 ES2020 BigInt 原生算法，无 64 位溢出风险，支持任意长度位宽的高精度转换。
        </p>
        <p>
          • <strong>终端复制自适应</strong>：在终端内选中如 <code>0xCAFE</code>、<code>0b1101</code>、<code>755</code> 或普通数字时，将直接自动路由至此工具面板。
        </p>
      </div>
    </div>
  );
}
