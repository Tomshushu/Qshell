/** 从 start 位置开始做平衡括号匹配，返回匹配的结束括号下标；未闭合或不匹配返回 -1 */
function findBalancedEnd(text: string, start: number): number {
  const pairs: Record<string, string> = { "{": "}", "[": "]" };
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if (top && pairs[top] === ch) {
        stack.pop();
        if (stack.length === 0) return i;
      } else {
        return -1;
      }
    }
  }
  return -1;
}

/**
 * 从文本中检测并提取首个 JSON：
 * 1. 优先尝试将整个（trim 后）文本解析为 JSON；
 * 2. 失败时提取首个由 `{` / `[` 包裹且括号平衡的 JSON 子串。
 * 返回 `{ json, parsed }`；既非 JSON 也无可提取子串时返回 `null`。
 */
export function extractJson(text: string): { json: string; parsed: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return { json: trimmed, parsed: JSON.parse(trimmed) };
  } catch {
    /* 继续尝试提取子串 */
  }

  const start = trimmed.search(/[{[]/);
  if (start === -1) return null;

  const end = findBalancedEnd(trimmed, start);
  if (end === -1) return null;

  const candidate = trimmed.slice(start, end + 1);
  try {
    return { json: candidate, parsed: JSON.parse(candidate) };
  } catch {
    return null;
  }
}

/**
 * 从文本中提取所有 JSON：
 * 1. 整个文本是合法 JSON 时返回单项；
 * 2. 否则顺序扫描所有 `{` / `[` 平衡括号片段，保留可成功解析的 JSON。
 * 用于「一段文本里嵌多个 JSON」场景，格式化时从上到下依次排列。
 */
export function extractAllJson(text: string): { json: string; parsed: unknown }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    return [{ json: trimmed, parsed: JSON.parse(trimmed) }];
  } catch {
    /* 继续扫描子串 */
  }

  const results: { json: string; parsed: unknown }[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const rel = trimmed.slice(i).search(/[{[]/);
    if (rel === -1) break;
    const start = i + rel;
    const end = findBalancedEnd(trimmed, start);
    if (end === -1) break;
    const candidate = trimmed.slice(start, end + 1);
    try {
      results.push({ json: candidate, parsed: JSON.parse(candidate) });
    } catch {
      /* 非合法 JSON，跳过 */
    }
    i = end + 1;
  }
  return results;
}
