#!/usr/bin/env node
/**
 * IPC 契约一致性检查
 *
 * 校验「前端调用的 Tauri command」是否都在「Rust 侧 generate_handler!」中注册。
 *
 * 背景：前端参数名改了、Rust 没跟上，或命令改名后漏删调用方，
 * TypeScript 与 cargo 都发现不了——只有用户点到那个按钮才会报错。
 * 这个脚本把这类「静默失效」提前到 CI。
 *
 * 只做静态字面量匹配；动态拼接的命令名无法检测。
 *
 * 用法：
 *   node tools/check-ipc-contract.mjs             # 只报告缺失（CI 用）
 *   node tools/check-ipc-contract.mjs --verbose   # 额外列出未被前端引用的 Rust 命令
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const RUST_HANDLER = join(ROOT, "src-tauri", "src", "lib.rs");
const SRC_DIR = join(ROOT, "src");
const VERBOSE = process.argv.includes("--verbose");

/** 递归收集 src 下的 ts/tsx（跳过测试与 __tests__） */
function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      collect(full, out);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * 从源码中提取 invoke / safeInvoke / invokeJson 的字面量命令名。
 *
 * 不能只靠一条正则：泛型实参里可能出现括号，例如
 *   safeInvoke<import('@/types').SerialPortInfo[]>("serial_list_ports")
 * 因此这里手工向后扫描，遇到「括号后紧跟字符串字面量」才认定为命令名，
 * 遇到类型导入的括号则跳过整段。
 */
function extractCommandNames(code) {
  const names = new Set();
  const CALL_RE = /\b(?:invoke|safeInvoke|invokeJson)\b/g;
  const LITERAL_AFTER_PAREN = /^\(\s*["']([a-z][a-z0-9_]*)["']/;
  let m;

  while ((m = CALL_RE.exec(code))) {
    // 跳过函数定义处（async function safeInvoke<T>( / function invokeJson<T>(）
    const before = code.slice(Math.max(0, m.index - 24), m.index);
    if (/function\s+$/.test(before)) continue;

    let i = m.index + m[0].length;
    // 泛型实参可能跨多行、含对象类型（{ ...; }）或 import('...')，用尖括号深度跟踪
    let angle = 0;
    const limit = Math.min(code.length, i + 2000);

    while (i < limit) {
      const ch = code[i];

      if (ch === "<") {
        angle++;
        i++;
        continue;
      }
      if (ch === ">") {
        if (angle > 0) angle--;
        i++;
        continue;
      }

      if (ch === "(") {
        if (angle > 0) {
          // 泛型内的括号（如 import('@/types')），整段跳过
          let depth = 0;
          while (i < limit) {
            if (code[i] === "(") depth++;
            else if (code[i] === ")") {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
            i++;
          }
          continue;
        }

        const literal = LITERAL_AFTER_PAREN.exec(code.slice(i, i + 80));
        if (literal) names.add(literal[1]);
        break;
      }

      // 语句边界（仅在泛型之外才成立）
      if (angle === 0 && (ch === ";" || ch === "{" || ch === "}")) break;

      i++;
    }
  }

  return names;
}

// ---------- Rust 侧：generate_handler! 中注册的命令 ----------
const rustSource = readFileSync(RUST_HANDLER, "utf8");
const handler = /generate_handler!\s*\[([\s\S]*?)\]/.exec(rustSource);
if (!handler) {
  console.error("[ipc-contract] 未能在 src-tauri/src/lib.rs 中找到 generate_handler! 块");
  process.exit(2);
}

const rustCommands = new Set();
for (const m of handler[1].matchAll(/commands::[A-Za-z0-9_]+::([A-Za-z0-9_]+)/g)) {
  rustCommands.add(m[1]);
}

// ---------- 前端侧 ----------
const frontendCommands = new Map(); // cmd -> Set<file>

for (const file of collect(SRC_DIR)) {
  const code = readFileSync(file, "utf8");
  for (const cmd of extractCommandNames(code)) {
    if (!frontendCommands.has(cmd)) frontendCommands.set(cmd, new Set());
    frontendCommands.get(cmd).add(relative(ROOT, file).replace(/\\/g, "/"));
  }
}

// ---------- 对比 ----------
const missing = [...frontendCommands.keys()].filter((c) => !rustCommands.has(c)).sort();
const unused = [...rustCommands].filter((c) => !frontendCommands.has(c)).sort();

console.log(
  `[ipc-contract] Rust 已注册 ${rustCommands.size} 个命令，前端引用 ${frontendCommands.size} 个`,
);

if (VERBOSE && unused.length) {
  console.log(`\n[ipc-contract] Rust 注册但前端未引用（${unused.length} 个，仅供参考）：`);
  for (const c of unused) console.log(`  - ${c}`);
}

if (missing.length) {
  console.error(`\n[ipc-contract] 前端调用了未注册的命令（${missing.length} 个）：`);
  for (const c of missing) {
    console.error(`  x ${c}  <-  ${[...frontendCommands.get(c)].join(", ")}`);
  }
  console.error(
    "\n请检查：命令是否已在 src-tauri/src/lib.rs 的 generate_handler! 中注册，或前端命令名是否拼错。",
  );
  process.exit(1);
}

console.log("[ipc-contract] OK: 所有前端调用的命令都已在 Rust 侧注册。");
