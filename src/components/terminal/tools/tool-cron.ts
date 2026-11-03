/**
 * Cron 表达式解析与自然语言翻译引擎
 * 支持标准 5 位 (分 时 日 月 周) 与 6 位 (秒 分 时 日 月 周)
 */

export interface CronParseResult {
  valid: boolean;
  error?: string;
  expression: string;
  humanText: string;
  nextOccurrences: string[];
}

const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月"
];

const WEEKDAY_NAMES = [
  "周日", "周一", "周二", "周三", "周四", "周五", "周六"
];

/** 预设常用 Cron 列表 */
export const CRON_PRESETS = [
  { label: "每 5 分钟", expr: "*/5 * * * *" },
  { label: "每小时整点", expr: "0 * * * *" },
  { label: "每天凌晨 2:00", expr: "0 2 * * *" },
  { label: "每个工作日 09:30", expr: "30 9 * * 1-5" },
  { label: "每周一凌晨 03:00", expr: "0 3 * * 1" },
  { label: "每月 1 号凌晨 00:00", expr: "0 0 1 * *" },
  { label: "每 30 秒 (6位)", expr: "*/30 * * * * *" },
];

/**
 * 展开 cron 字段为数字集合
 */
function parseField(field: string, min: number, max: number): number[] | null {
  const result = new Set<number>();
  const parts = field.split(",");

  for (const part of parts) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    // Step 形式：*/5 或 10-30/5
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return null;

      let start = min;
      let end = max;
      if (rangeStr !== "*") {
        if (rangeStr.includes("-")) {
          const [s, e] = rangeStr.split("-").map((v) => parseInt(v, 10));
          if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) return null;
          start = s;
          end = e;
        } else {
          start = parseInt(rangeStr, 10);
          if (isNaN(start) || start < min || start > max) return null;
        }
      }

      for (let i = start; i <= end; i += step) {
        result.add(i);
      }
      continue;
    }

    // Range 形式：1-5
    if (part.includes("-")) {
      const [s, e] = part.split("-").map((v) => parseInt(v, 10));
      if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) return null;
      for (let i = s; i <= e; i++) result.add(i);
      continue;
    }

    // 单个数字
    const num = parseInt(part, 10);
    if (isNaN(num) || num < min || num > max) return null;
    result.add(num);
  }

  return Array.from(result).sort((a, b) => a - b);
}

/**
 * 将 cron 表达式解析为自然语言（中文）
 */
function explainCron(fields: string[], is6Part: boolean): string {
  const [secOrMin, f2, f3, f4, f5, f6] = fields;
  const sec = is6Part ? secOrMin : "0";
  const min = is6Part ? f2 : secOrMin;
  const hour = is6Part ? f3 : f2;
  const day = is6Part ? f4 : f3;
  const month = is6Part ? f5 : f4;
  const week = is6Part ? f6 : f5;

  const desc: string[] = [];

  // 周
  if (week !== "*") {
    if (week.includes("-")) {
      const [w1, w2] = week.split("-").map((w) => WEEKDAY_NAMES[parseInt(w, 10) % 7]);
      desc.push(`在每周 ${w1} 至 ${w2}`);
    } else {
      const list = week.split(",").map((w) => WEEKDAY_NAMES[parseInt(w, 10) % 7]);
      desc.push(`在每周 ${list.join("、")}`);
    }
  }

  // 月
  if (month !== "*") {
    if (month.includes("-")) {
      const [m1, m2] = month.split("-").map((m) => MONTH_NAMES[parseInt(m, 10) - 1]);
      desc.push(`在每年 ${m1} 至 ${m2}`);
    } else {
      const list = month.split(",").map((m) => MONTH_NAMES[parseInt(m, 10) - 1]);
      desc.push(`在每年 ${list.join("、")}`);
    }
  }

  // 日
  if (day !== "*") {
    if (day.startsWith("*/")) {
      desc.push(`每隔 ${day.slice(2)} 天`);
    } else {
      desc.push(`在每月 ${day} 号`);
    }
  }

  // 时与分与秒
  if (hour.startsWith("*/")) {
    desc.push(`每隔 ${hour.slice(2)} 小时`);
  } else if (hour !== "*") {
    desc.push(`在 ${hour.padStart(2, "0")} 点`);
  }

  if (min.startsWith("*/")) {
    desc.push(`每隔 ${min.slice(2)} 分钟`);
  } else if (min !== "*") {
    if (hour === "*") {
      desc.push(`在每小时的第 ${min} 分钟`);
    } else {
      desc.push(`${min.padStart(2, "0")} 分`);
    }
  }

  if (is6Part && sec !== "*") {
    if (sec.startsWith("*/")) {
      desc.push(`每隔 ${sec.slice(2)} 秒`);
    } else {
      desc.push(`${sec.padStart(2, "0")} 秒`);
    }
  }

  if (desc.length === 0) {
    return is6Part ? "每秒执行一次" : "每分钟执行一次";
  }

  return `${desc.join(" ")} 执行一次`;
}

/**
 * 计算未来执行时间列表 (默认计算未来 5 次)
 */
function computeNextRuns(
  secList: number[],
  minList: number[],
  hourList: number[],
  dayList: number[],
  monthList: number[],
  weekList: number[],
  count: number = 5
): string[] {
  const runs: string[] = [];
  const cur = new Date();
  cur.setMilliseconds(0);
  // 从下一秒/分开始寻找
  cur.setSeconds(cur.getSeconds() + 1);

  const maxChecks = 50000;
  let checks = 0;

  const monthSet = new Set(monthList);
  const daySet = new Set(dayList);
  const weekSet = new Set(weekList);
  const hourSet = new Set(hourList);
  const minSet = new Set(minList);
  const secSet = new Set(secList);

  while (runs.length < count && checks < maxChecks) {
    checks++;
    const m = cur.getMonth() + 1;
    if (!monthSet.has(m)) {
      cur.setMonth(cur.getMonth() + 1, 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }

    const d = cur.getDate();
    const w = cur.getDay(); // 0 is Sunday
    // 如果 day 和 week 同时指定，通常是或关系；此处按标准匹配
    if (!daySet.has(d) || !weekSet.has(w)) {
      cur.setDate(cur.getDate() + 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }

    const h = cur.getHours();
    if (!hourSet.has(h)) {
      cur.setHours(cur.getHours() + 1, 0, 0, 0);
      continue;
    }

    const min = cur.getMinutes();
    if (!minSet.has(min)) {
      cur.setMinutes(cur.getMinutes() + 1, 0, 0);
      continue;
    }

    const s = cur.getSeconds();
    if (secSet.has(s)) {
      const year = cur.getFullYear();
      const month = String(cur.getMonth() + 1).padStart(2, "0");
      const date = String(cur.getDate()).padStart(2, "0");
      const hour = String(cur.getHours()).padStart(2, "0");
      const minute = String(cur.getMinutes()).padStart(2, "0");
      const second = String(cur.getSeconds()).padStart(2, "0");
      const weekName = WEEKDAY_NAMES[cur.getDay()];
      runs.push(`${year}-${month}-${date} ${hour}:${minute}:${second} (${weekName})`);
    }

    cur.setSeconds(cur.getSeconds() + 1);
  }

  return runs;
}

/**
 * 主解析入口函数
 */
export function parseCronExpression(rawExpr: string): CronParseResult {
  const trimmed = rawExpr.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "请输入 Cron 表达式",
      expression: "",
      humanText: "",
      nextOccurrences: [],
    };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return {
      valid: false,
      error: `Cron 表达式字段数量错误: 需为 5 位 (分 时 日 月 周) 或 6 位 (秒 分 时 日 月 周)，当前为 ${parts.length} 位`,
      expression: trimmed,
      humanText: "",
      nextOccurrences: [],
    };
  }

  const is6Part = parts.length === 6;
  const secParts = is6Part ? parseField(parts[0], 0, 59) : [0];
  const minParts = parseField(is6Part ? parts[1] : parts[0], 0, 59);
  const hourParts = parseField(is6Part ? parts[2] : parts[1], 0, 23);
  const dayParts = parseField(is6Part ? parts[3] : parts[2], 1, 31);
  const monthParts = parseField(is6Part ? parts[4] : parts[3], 1, 12);
  const weekParts = parseField(is6Part ? parts[5] : parts[4], 0, 7); // 7 兼容为 0 (周日)

  if (
    !secParts ||
    !minParts ||
    !hourParts ||
    !dayParts ||
    !monthParts ||
    !weekParts
  ) {
    return {
      valid: false,
      error: "Cron 表达式中包含超出合法范围的数值或语法错误",
      expression: trimmed,
      humanText: "",
      nextOccurrences: [],
    };
  }

  // 7 映射为 0 (周日)
  const normalizedWeek = Array.from(new Set(weekParts.map((w) => (w === 7 ? 0 : w)))).sort((a, b) => a - b);

  try {
    const humanText = explainCron(parts, is6Part);
    const nextOccurrences = computeNextRuns(
      secParts,
      minParts,
      hourParts,
      dayParts,
      monthParts,
      normalizedWeek,
      5
    );

    return {
      valid: true,
      expression: trimmed,
      humanText,
      nextOccurrences,
    };
  } catch (e) {
    return {
      valid: false,
      error: `解析发生异常: ${String(e)}`,
      expression: trimmed,
      humanText: "",
      nextOccurrences: [],
    };
  }
}
