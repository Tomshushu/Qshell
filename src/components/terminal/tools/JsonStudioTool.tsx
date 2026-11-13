import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Copy,
  Check,
  Braces,
  Minimize2,
  ArrowUpDown,
  CheckCircle2,
  ClipboardPaste,
  Trash2,
  GitCompare,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { playSound, SoundType } from "@/lib/sound";
import { SideBySideDiffViewer } from "./diff/SideBySideDiffViewer";
import { computeTextDiff } from "./diff/text-diff-engine";

interface JsonStudioToolProps {
  initialJson?: string;
}

const SAMPLE_LEFT_JSON = `{
  "status": "success",
  "code": 200,
  "data": {
    "server": "prod-gateway-01",
    "ip": "10.0.4.12",
    "uptimeSeconds": 864200,
    "services": [
      { "name": "nginx", "port": 80, "healthy": true },
      { "name": "auth-service", "port": 8080, "healthy": true }
    ],
    "metrics": {
      "cpuUsage": 12.4,
      "memoryUsedMb": 1024,
      "memoryTotalMb": 4096
    }
  }
}`;

const SAMPLE_RIGHT_JSON = `{
  "status": "success",
  "code": 200,
  "data": {
    "server": "prod-gateway-02",
    "ip": "10.0.4.99",
    "uptimeSeconds": 920000,
    "services": [
      { "name": "nginx", "port": 80, "healthy": true },
      { "name": "auth-service", "port": 8080, "healthy": false }
    ],
    "metrics": {
      "cpuUsage": 28.6,
      "memoryUsedMb": 2048,
      "memoryTotalMb": 4096
    }
  }
}`;

function sortJsonKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortJsonKeys);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return obj;
}

export interface JsonDiffItem {
  path: string;
  type: "added" | "removed" | "modified";
  leftVal?: unknown;
  rightVal?: unknown;
}

export function computeJsonDiff(left: unknown, right: unknown, path = ""): JsonDiffItem[] {
  if (left === right) return [];

  const leftType = typeof left;
  const rightType = typeof right;

  if (left === null || right === null || leftType !== rightType || leftType !== "object") {
    return [{ path: path || "(root)", type: "modified", leftVal: left, rightVal: right }];
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const diffs: JsonDiffItem[] = [];
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      const curPath = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= left.length) {
        diffs.push({ path: curPath, type: "added", rightVal: right[i] });
      } else if (i >= right.length) {
        diffs.push({ path: curPath, type: "removed", leftVal: left[i] });
      } else {
        diffs.push(...computeJsonDiff(left[i], right[i], curPath));
      }
    }
    return diffs;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return [{ path: path || "(root)", type: "modified", leftVal: left, rightVal: right }];
  }

  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const allKeys = Array.from(new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]));
  const diffs: JsonDiffItem[] = [];

  for (const k of allKeys) {
    const curPath = path ? `${path}.${k}` : k;
    if (!(k in leftObj)) {
      diffs.push({ path: curPath, type: "added", rightVal: rightObj[k] });
    } else if (!(k in rightObj)) {
      diffs.push({ path: curPath, type: "removed", leftVal: leftObj[k] });
    } else {
      diffs.push(...computeJsonDiff(leftObj[k], rightObj[k], curPath));
    }
  }

  return diffs;
}

const STORAGE_KEY_INDENT = "qshell_json_studio_indent";

// 只持久化缩进偏好；文本内容绝不自动恢复，弹框每次打开都是干净的
function loadSavedIndent(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INDENT);
    if (raw === "4") return 4;
  } catch {
    /* ignore */
  }
  return 2;
}

function saveIndentPreference(indent: number) {
  try {
    localStorage.setItem(STORAGE_KEY_INDENT, String(indent));
  } catch {
    /* ignore */
  }
}

/**
 * 健壮的 JSON 解析器：
 * 1. 标准严格 JSON 优先，绝不做全局字符替换（否则会破坏字符串值内合法的 \" 与 \\）
 *    若解析结果是「被外层引号包住的 JSON 字符串」('"{\"a\":1}"')，再解一层拿到真正的对象
 * 2. 日志/终端输出里整段被转义的 JSON（'{\"a\":1}'，可能多层转义）：
 *    按 JSON 字符串字面量语义逐层解包，且只有解包结果是对象/数组且能严格解析时才认定为 JSON，
 *    避免普通日志被误判，也避免粗暴替换导致解析出错误内容
 */
export function tryParseJson(text: string): { success: boolean; data?: unknown; error?: string } {
  const clean = text.trim();
  if (!clean) return { success: false, error: "内容为空" };

  // 1. 标准严格解析（含外层引号包裹的 JSON 字符串）
  try {
    const parsed = JSON.parse(clean);
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (/^[{\[]/.test(inner)) {
        try {
          return { success: true, data: JSON.parse(inner) };
        } catch {
          // 字符串内容不是完整 JSON，按普通字符串返回
        }
      }
    }
    return { success: true, data: parsed };
  } catch (e1) {
    // 2. 按 JSON 字符串字面量语义逐层解包（最多 3 层转义）
    if (clean.includes("\\")) {
      let candidate = clean;
      for (let depth = 0; depth < 3; depth++) {
        try {
          candidate = JSON.parse(`"${candidate.replace(/\r?\n/g, "\\n")}"`) as string;
        } catch {
          break;
        }
        const trimmed = candidate.trim();
        if (!/^[{\[]/.test(trimmed)) break;
        try {
          return { success: true, data: JSON.parse(trimmed) };
        } catch {
          // 可能还有一层转义，继续解包
        }
      }
    }

    return { success: false, error: e1 instanceof Error ? e1.message : String(e1) };
  }
}

export function JsonStudioTool({ initialJson = "" }: JsonStudioToolProps) {
  // 左侧原始文本：默认留空，仅右键/划词「格式化 JSON」等用户主动入口才会带内容进来
  const [leftText, setLeftText] = useState(() =>
    initialJson && initialJson.trim() ? initialJson.trim() : ""
  );

  // 右侧对比目标：默认留空，绝不自动填充示例或上次编辑内容
  const [rightText, setRightText] = useState("");

  const [indentSize, setIndentSize] = useState<number>(() => loadSavedIndent());
  const [copiedLeft, setCopiedLeft] = useState(false);
  const [copiedRight, setCopiedRight] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "diff">("edit");

  // 1. 仅用户主动入口（右键/划词「格式化 JSON」、弹框内读取剪贴板）会设置 seed，
  //    这里把内容填到左侧原始输入，等待用户主动点击「格式化」
  useEffect(() => {
    if (initialJson && initialJson.trim()) {
      setLeftText(initialJson.trim());
    }
  }, [initialJson]);

  // 2. 显式注入事件：同样只由用户主动入口派发，覆盖左侧原文，不自动格式化
  useEffect(() => {
    const handleInject = (e: Event) => {
      const customEvt = e as CustomEvent<{ text: string }>;
      const text = customEvt.detail?.text;
      if (text && text.trim()) {
        setLeftText(text.trim());
      }
    };
    window.addEventListener("qshell:inject-json-studio", handleInject);
    return () => window.removeEventListener("qshell:inject-json-studio", handleInject);
  }, []);

  // 3. 只持久化缩进偏好；文本内容不落盘、不自动恢复
  useEffect(() => {
    const timer = setTimeout(() => {
      saveIndentPreference(indentSize);
    }, 200);
    return () => clearTimeout(timer);
  }, [indentSize]);

  // 解析并校验左侧 JSON (用于语法指示与 Diff)
  const leftParseResult = useMemo(() => {
    if (!leftText.trim()) return { data: null, error: null };
    const res = tryParseJson(leftText);
    if (res.success) return { data: res.data, error: null };
    return { data: null, error: res.error || "JSON 语法错误" };
  }, [leftText]);

  // 解析并校验右侧 JSON (用于语法指示与 Diff)
  const rightParseResult = useMemo(() => {
    if (!rightText.trim()) return { data: null, error: null };
    const res = tryParseJson(rightText);
    if (res.success) return { data: res.data, error: null };
    return { data: null, error: res.error || "JSON 语法错误" };
  }, [rightText]);

  // 计算通用文本与字符串差异列表 (支持普通字符串/日志/配置/JSON)
  const textDiff = useMemo(() => {
    if (!leftText && !rightText) return null;
    return computeTextDiff(leftText, rightText);
  }, [leftText, rightText]);

  // 计算 JSON 结构差异 (保留兼容性)
  const diffs = useMemo(() => {
    if (leftParseResult.data === null || rightParseResult.data === null) {
      return null;
    }
    return computeJsonDiff(leftParseResult.data, rightParseResult.data);
  }, [leftParseResult.data, rightParseResult.data]);

  // 手动格式化执行函数：由用户主动触发（点击按钮或快捷键 Ctrl+Enter）
  // 调研成熟产品 (DevToys / CyberChef / Postman / JSONDiff)：
  // 场景 A：如果右侧为空或与左侧相同，用户输入在左侧，点击「格式化」是将左侧格式化输出到右侧（保留左侧原始输入用于对照）
  // 场景 B：如果左右两侧都有不同的 JSON（双栏对比场景），点击「格式化」对双侧分别进行规范化缩进与美化，以便精准高亮 Diff
  // 场景 C：右侧是普通文本/日志（非 JSON），保留右侧原样，仅就地美化左侧，绝不覆盖用户的对比目标
  const handleFormat = useCallback(
    (targetSide: "left" | "right" | "both" = "both", indent = indentSize) => {
      if (targetSide === "left") {
        const parseRes = tryParseJson(leftText);
        if (parseRes.success) {
          setLeftText(JSON.stringify(parseRes.data, null, indent));
          playSound(SoundType.Click);
        }
        return;
      }

      if (targetSide === "right") {
        const parseRes = tryParseJson(rightText);
        if (parseRes.success) {
          setRightText(JSON.stringify(parseRes.data, null, indent));
          playSound(SoundType.Click);
        }
        return;
      }

      // targetSide === "both" (主格式化按钮)
      const leftParse = tryParseJson(leftText);
      const rightParse = tryParseJson(rightText);

      if (leftParse.success) {
        const formattedLeft = JSON.stringify(leftParse.data, null, indent);
        if (!rightText.trim() || rightText === leftText) {
          setRightText(formattedLeft);
        } else if (rightParse.success) {
          setLeftText(formattedLeft);
          setRightText(JSON.stringify(rightParse.data, null, indent));
        } else {
          // 右侧是用户粘贴的普通文本/日志（非 JSON）：原样保留，只在左侧就地美化
          setLeftText(formattedLeft);
        }
        playSound(SoundType.Click);
      } else if (rightParse.success) {
        setRightText(JSON.stringify(rightParse.data, null, indent));
        playSound(SoundType.Click);
      }
    },
    [leftText, rightText, indentSize]
  );

  /**
   * 主「格式化」按钮 / Ctrl+Enter 入口：
   * 左右都为空时，仅在用户主动点击的这一刻从剪贴板取内容（绝不监听复制事件或轮询剪贴板），
   * 原文填入左侧，格式化结果输出到右侧；其余情况走常规格式化。
   */
  const handleFormatButton = useCallback(async () => {
    if (!leftText.trim() && !rightText.trim()) {
      let clip = "";
      try {
        clip = navigator.clipboard?.readText ? await navigator.clipboard.readText() : "";
      } catch {
        /* ignore */
      }
      if (clip && clip.trim()) {
        const clean = clip.trim();
        setLeftText(clean);
        const res = tryParseJson(clean);
        if (res.success) {
          setRightText(JSON.stringify(res.data, null, indentSize));
        }
        playSound(SoundType.Click);
        return;
      }
    }
    handleFormat("both");
  }, [leftText, rightText, indentSize, handleFormat]);

  // 键盘快捷键：Ctrl+Enter 或 Cmd+Enter 手动触发格式化
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void handleFormatButton();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleFormatButton]);

  // 压缩为一行
  const handleMinify = (targetSide: "left" | "right" | "both" = "both") => {
    const leftParse = tryParseJson(leftText);
    const rightParse = tryParseJson(rightText);
    if (leftParse.success) {
      const minifiedLeft = JSON.stringify(leftParse.data);
      if (!rightText.trim() || rightText === leftText) {
        setRightText(minifiedLeft);
      } else if (rightParse.success) {
        setLeftText(minifiedLeft);
        setRightText(JSON.stringify(rightParse.data));
      } else {
        // 右侧非 JSON 时保留对比目标，不覆盖丢失
        setLeftText(minifiedLeft);
      }
      playSound(SoundType.Click);
    } else if (rightParse.success) {
      setRightText(JSON.stringify(rightParse.data));
      playSound(SoundType.Click);
    }
  };

  // 递归排序键名 (双侧)
  const handleSortKeys = (targetSide: "left" | "right" | "both" = "both") => {
    const leftParse = tryParseJson(leftText);
    const rightParse = tryParseJson(rightText);
    if (leftParse.success) {
      const sortedLeft = JSON.stringify(sortJsonKeys(leftParse.data), null, indentSize);
      if (!rightText.trim() || rightText === leftText) {
        setRightText(sortedLeft);
      } else if (rightParse.success) {
        setLeftText(sortedLeft);
        setRightText(JSON.stringify(sortJsonKeys(rightParse.data), null, indentSize));
      } else {
        // 右侧非 JSON 时保留对比目标，不覆盖丢失
        setLeftText(sortedLeft);
      }
      playSound(SoundType.Click);
    } else if (rightParse.success) {
      setRightText(JSON.stringify(sortJsonKeys(rightParse.data), null, indentSize));
      playSound(SoundType.Click);
    }
  };

  // 转义带反斜杠
  const handleEscape = () => {
    if (rightText.trim()) {
      setRightText(JSON.stringify(rightText));
    } else if (leftText.trim()) {
      setRightText(JSON.stringify(leftText));
    }
  };

  // 去除反斜杠还原
  const handleUnescape = () => {
    const src = rightText.trim() ? rightText : leftText;
    if (!src) return;
    try {
      const unescaped = JSON.parse(src);
      const res = typeof unescaped === "string" ? unescaped : JSON.stringify(unescaped, null, indentSize);
      if (rightText.trim()) setRightText(res);
      else setLeftText(res);
    } catch {
      const res = src.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      if (rightText.trim()) setRightText(res);
      else setLeftText(res);
    }
  };

  // 交换左右两侧内容
  const handleSwap = () => {
    setLeftText(rightText);
    setRightText(leftText);
  };

  // 复制左侧
  const handleCopyLeft = async () => {
    if (!leftText) return;
    try {
      await navigator.clipboard.writeText(leftText);
      setCopiedLeft(true);
      setTimeout(() => setCopiedLeft(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // 复制右侧
  const handleCopyRight = async () => {
    if (!rightText) return;
    try {
      await navigator.clipboard.writeText(rightText);
      setCopiedRight(true);
      setTimeout(() => setCopiedRight(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // 从剪贴板粘贴到左侧原始区域（仅填充左侧，绝不自动覆盖或格式化右侧）
  const handlePasteLeft = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLeftText(text.trim());
      }
    } catch {
      /* ignore */
    }
  };

  // 点击「格式化到右」：主动将左侧内容格式化输出到右侧
  const handleSyncToRight = () => {
    if (!leftText.trim()) return;
    const res = tryParseJson(leftText);
    if (res.success) {
      setRightText(JSON.stringify(res.data, null, indentSize));
      playSound(SoundType.Click);
    } else {
      setRightText(leftText);
    }
  };

  // 载入示例对比数据
  const handleLoadSample = () => {
    setLeftText(SAMPLE_LEFT_JSON);
    setRightText(SAMPLE_RIGHT_JSON);
    setViewMode("diff");
  };

  // 清空全部
  const handleClearAll = () => {
    setLeftText("");
    setRightText("");
    setViewMode("edit");
  };

  // 统计信息
  const leftStats = useMemo(() => {
    if (!leftText) return "0 行 · 0 B";
    const lines = leftText.split("\n").length;
    const bytes = new Blob([leftText]).size;
    const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    return `${lines} 行 · ${sizeStr}`;
  }, [leftText]);

  const leftStatsCompact = useMemo(() => {
    if (!leftText) return "0 行";
    const lines = leftText.split("\n").length;
    return `${lines} 行`;
  }, [leftText]);

  const rightStats = useMemo(() => {
    if (!rightText) return "0 行 · 0 B";
    const lines = rightText.split("\n").length;
    const bytes = new Blob([rightText]).size;
    const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    return `${lines} 行 · ${sizeStr}`;
  }, [rightText]);

  const rightStatsCompact = useMemo(() => {
    if (!rightText) return "0 行";
    const lines = rightText.split("\n").length;
    return `${lines} 行`;
  }, [rightText]);

  return (
    <div className="flex h-full w-full flex-col select-text overflow-hidden bg-background">
      {/* 顶部单行集成工具栏 (将操作上提至首行，小窗口下自适应紧凑布局，绝不折行换行) */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-1.5 border-b border-border bg-muted/20 px-2.5 overflow-x-auto no-scrollbar">
        {/* 左侧：格式化、缩进、常用变换与对比控制 */}
        <div className="flex items-center gap-1 shrink-0 flex-nowrap">
          <Button
            size="sm"
            className="h-7 px-2 text-xs gap-1 font-medium active:scale-[0.97] transition-all cursor-pointer shadow-2xs shrink-0"
            onClick={() => void handleFormatButton()}
            title="格式化左侧和右侧 JSON（左右都为空时由本次点击从剪贴板读取，不会自动写入）"
          >
            <Braces className="h-3.5 w-3.5 text-primary-foreground" />
            <span>格式化</span>
          </Button>

          <select
            value={indentSize}
            onChange={(e) => {
              const sz = parseInt(e.target.value, 10);
              setIndentSize(sz);
              handleFormat("both", sz);
            }}
            className="h-7 rounded-md border border-input bg-background/80 px-1.5 text-xs text-foreground outline-none cursor-pointer hover:border-primary/40 transition-colors shrink-0"
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
          </select>

          <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" />

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-1.5 text-xs gap-1 text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={() => handleMinify("both")}
            title="压缩成单行紧凑 JSON"
          >
            <Minimize2 className="h-3 w-3" />
            <span>压缩</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-1.5 text-xs gap-1 text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={() => handleSortKeys("both")}
            title="按键名字母升序递归排序 (对比神器)"
          >
            <ArrowUpDown className="h-3 w-3" />
            <span>排序</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={handleEscape}
            title="将右侧或当前 JSON 转换为反斜杠转义字符串"
          >
            转义
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={handleUnescape}
            title="去除反斜杠转义还原"
          >
            去转义
          </Button>

          <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" />

          <Button
            variant={viewMode === "diff" ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-1 active:scale-[0.97] transition-all cursor-pointer shrink-0",
              viewMode === "diff"
                ? "bg-primary/15 text-primary border-primary/30 font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewMode((v) => (v === "diff" ? "edit" : "diff"))}
            title="切换并排差异比对视图 (支持普通字符串/日志/JSON)"
          >
            <GitCompare className="h-3 w-3" />
            <span>{viewMode === "diff" ? "编辑" : "对比"}</span>
            {textDiff && textDiff.diffCount > 0 && (
              <span className="ml-0.5 rounded-full bg-amber-500/20 px-1 py-0.2 text-[10px] font-mono text-amber-600 dark:text-amber-400">
                {textDiff.diffCount}
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={handleSwap}
            title="左右两侧内容互换"
          >
            <ArrowLeftRight className="h-3 w-3" />
            <span className="hidden 2xl:inline">互换</span>
          </Button>
        </div>

        {/* 右侧：状态指示器与快捷辅助 */}
        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap ml-auto">
          {/* 实时校验与对比状态提示 (支持普通字符串与非 JSON 文本) */}
          {textDiff ? (
            textDiff.isIdentical ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                <span>两边一致</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 cursor-pointer transition-colors shrink-0"
                title="点击展开并排差异比对视图"
              >
                <GitCompare className="h-3 w-3 shrink-0" />
                <span>{textDiff.diffCount} 处差异</span>
              </button>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5 py-0.5 shrink-0">
              <span>输入中...</span>
            </span>
          )}

          <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={handleLoadSample}
            title="载入双栏对比示例数据"
          >
            示例
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive active:scale-[0.97] transition-all cursor-pointer shrink-0"
            onClick={handleClearAll}
            title="清空左右两侧数据"
          >
            清空
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 active:scale-[0.97] transition-all cursor-pointer shadow-2xs shrink-0"
            onClick={handleCopyRight}
            title="复制右侧 JSON"
          >
            {copiedRight ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
            <span>{copiedRight ? "已复制" : "复制"}</span>
          </Button>
        </div>
      </div>

      {/* 主体区：支持「双栏编辑模式」与「并排差异比对视图」平滑切换 */}
      {viewMode === "diff" ? (
        <SideBySideDiffViewer
          leftText={leftText}
          rightText={rightText}
          onUpdateRightText={setRightText}
          onUpdateLeftText={setLeftText}
          onSwitchToEdit={() => setViewMode("edit")}
        />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2.5 gap-2">
          <div className="grid grid-cols-2 gap-2.5 flex-1 min-h-0">
            {/* 左侧栏：原始/对比输入 */}
            <div className="flex flex-col min-h-0 rounded-xl border border-border bg-card/40 overflow-hidden shadow-2xs">
              {/* 左侧顶栏 */}
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 bg-muted/30 px-2 text-xs min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 shrink">
                  <span className="flex items-center gap-1 font-medium text-foreground text-[11px] shrink-0 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
                    原始文本
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums truncate whitespace-nowrap" title={leftStats}>
                    ({leftStatsCompact})
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer gap-0.5"
                    onClick={handlePasteLeft}
                    title="从剪贴板粘贴到左侧"
                  >
                    <ClipboardPaste className="h-3 w-3" />
                    <span className="hidden xl:inline">粘贴</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer gap-0.5 font-medium whitespace-nowrap"
                    onClick={handleSyncToRight}
                    title="将左侧格式化并同步到右侧"
                  >
                    <ArrowRight className="h-3 w-3" />
                    <span className="whitespace-nowrap">格式化到右</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                    onClick={() => setLeftText("")}
                    title="清空左侧"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={handleCopyLeft}
                    title="复制左侧内容"
                  >
                    {copiedLeft ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>

              {/* 左侧编辑器 */}
              <div className="relative flex-1 min-h-0">
                <textarea
                  value={leftText}
                  onChange={(e) => setLeftText(e.target.value)}
                  placeholder="在此粘贴或输入原始文本/日志/JSON (左侧)..."
                  spellCheck={false}
                  className="h-full w-full resize-none p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/40 bg-transparent outline-none"
                />
                {leftParseResult.error && (
                  <div className="absolute bottom-2 left-2 right-2 rounded-md bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-400 backdrop-blur-md truncate shadow-sm">
                    ℹ️ 提示: 左侧为非标准 JSON（支持作为普通字符串进行并排比对）
                  </div>
                )}
              </div>
            </div>

            {/* 右侧栏：目标/对比输入 */}
            <div className="flex flex-col min-h-0 rounded-xl border border-border bg-card/40 overflow-hidden shadow-2xs">
              {/* 右侧顶栏 */}
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 bg-muted/30 px-2 text-xs min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 shrink">
                  <span className="flex items-center gap-1 font-medium text-foreground text-[11px] shrink-0 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    对比目标
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums truncate whitespace-nowrap" title={rightStats}>
                    ({rightStatsCompact})
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px] text-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer gap-0.5 font-medium whitespace-nowrap"
                    onClick={() => {
                      setLeftText(rightText);
                    }}
                    title="将右侧内容覆写到左侧"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    <span className="whitespace-nowrap">同步到左</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                    onClick={() => setRightText("")}
                    title="清空右侧"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={handleCopyRight}
                    title="复制右侧内容"
                  >
                    {copiedRight ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>

              {/* 右侧编辑器 */}
              <div className="relative flex-1 min-h-0">
                <textarea
                  value={rightText}
                  onChange={(e) => setRightText(e.target.value)}
                  placeholder="在此粘贴对比文本/日志/JSON (右侧)，或点击上方「格式化」将左侧生成到此处..."
                  spellCheck={false}
                  className="h-full w-full resize-none p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/40 bg-transparent outline-none"
                />
                {!rightText.trim() && leftText.trim() && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 pointer-events-none">
                    <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-background/85 backdrop-blur-sm p-4 text-center shadow-xs max-w-[280px]">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Braces className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-medium text-foreground">原始数据已就绪</span>
                      <span className="text-[11px] text-muted-foreground">已填入左侧，点击格式化到右侧或直接比对</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs gap-1.5 font-medium cursor-pointer shadow-2xs"
                          onClick={() => handleFormat("both")}
                        >
                          <Braces className="h-3.5 w-3.5" />
                          <span>格式化到右侧</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs gap-1 font-medium cursor-pointer"
                          onClick={() => setViewMode("diff")}
                        >
                          <GitCompare className="h-3.5 w-3.5 text-primary" />
                          <span>并排对比</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {rightParseResult.error && (
                  <div className="absolute bottom-2 left-2 right-2 rounded-md bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-400 backdrop-blur-md truncate shadow-sm">
                    ℹ️ 提示: 右侧为非标准 JSON（支持作为普通字符串进行并排比对）
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
