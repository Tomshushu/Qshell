#!/usr/bin/env node
/**
 * Real SSH log-stream stress test.
 *
 * Required:
 *   SSH_HOST, SSH_USER
 * Optional:
 *   SSH_PORT=22, SSH_TARGET=linux|windows, SSH_IDENTITY, SSH_EXTRA_ARGS
 *   LINES=100000, DURATION_SEC=300, LOG_PATH
 *
 * The test uses the same remote follow primitives as the application:
 *   Linux:   tail -n 0 -f
 *   Windows: Get-Content -Tail 0 -Wait
 * It measures first-byte latency, sustained throughput, peak local RSS, and
 * Ctrl+C-to-process-exit latency. Authentication is delegated to OpenSSH
 * (agent/key/askpass), so passwords are never placed in command arguments.
 */

import { spawn } from "node:child_process";
import process from "node:process";

const target = (process.env.SSH_TARGET || "linux").toLowerCase();
const host = process.env.SSH_HOST;
const user = process.env.SSH_USER;
const port = process.env.SSH_PORT || "22";
const identity = process.env.SSH_IDENTITY;
const extraArgs = process.env.SSH_EXTRA_ARGS
  ? process.env.SSH_EXTRA_ARGS.split(/\s+/).filter(Boolean)
  : [];
const lines = Number(process.env.LINES || 100_000);
const durationSec = Number(process.env.DURATION_SEC || 300);
const logPath = process.env.LOG_PATH || (target === "windows"
  ? "C:\\Windows\\Temp\\qshell-log-stress.log"
  : "/tmp/qshell-log-stress.log");

if (!host || !user) {
  console.error("SSH_HOST and SSH_USER are required");
  process.exit(2);
}
if (!Number.isInteger(lines) || lines < 1 || lines > 10_000_000) {
  console.error("LINES must be an integer between 1 and 10000000");
  process.exit(2);
}
if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 86_400) {
  console.error("DURATION_SEC must be an integer between 1 and 86400");
  process.exit(2);
}

const destination = `${user}@${host}`;
const baseArgs = [
  "-p", port,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=10",
  "-o", "ServerAliveCountMax=3",
  ...(identity ? ["-i", identity] : []),
  ...extraArgs,
  destination,
];

function encodePowerShell(script) {
  const utf16le = Buffer.from(script, "utf16le");
  return utf16le.toString("base64");
}

function remoteCommand(script) {
  if (target === "windows") {
    const encoded = encodePowerShell(script);
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  }
  return script;
}

function runRemote(script, options = {}) {
  const child = spawn("ssh", [...baseArgs, remoteCommand(script)], {
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  return child;
}

function escapePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const pathArg = target === "windows" ? escapePowerShell(logPath) : escapePosix(logPath);
const marker = `QSHELL_STRESS_${Date.now()}`;
const resetScript = target === "windows"
  ? `Set-Content -LiteralPath ${pathArg} -Value @() -Encoding utf8`
  : `: > ${pathArg}`;
const writeScript = target === "windows"
  ? `$p=${pathArg}; 1..${lines} | ForEach-Object { Add-Content -LiteralPath $p -Value '${marker}_'$_ }`
  : `for i in $(seq 1 ${lines}); do printf '%s_%s\\n' ${escapePosix(marker)} "$i" >> ${pathArg}; done`;
const followScript = target === "windows"
  ? `Get-Content -LiteralPath ${pathArg} -Tail 0 -Wait`
  : `tail -n 0 -f ${pathArg}`;

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

async function main() {
  console.log(JSON.stringify({ target, destination, lines, durationSec, logPath }, null, 2));
  const reset = runRemote(resetScript);
  const resetResult = await waitForExit(reset);
  if (resetResult.code !== 0) throw new Error(`reset failed: ${JSON.stringify(resetResult)}`);

  const writer = runRemote(writeScript);
  const follow = runRemote(followScript, { capture: true });
  let received = 0;
  let firstByteAt = null;
  const startedAt = performance.now();
  let lastSample = startedAt;
  let lastBytes = 0;
  let peakRss = process.memoryUsage().rss;

  follow.stdout.on("data", (chunk) => {
    if (firstByteAt === null) firstByteAt = performance.now();
    received += chunk.toString("utf8").split("\n").filter((line) => line.includes(marker)).length;
    const now = performance.now();
    if (now - lastSample >= 1000) {
      const rss = process.memoryUsage().rss;
      peakRss = Math.max(peakRss, rss);
      const delta = received - lastBytes;
      console.log(`progress received=${received}/${lines} lines_per_sec=${delta.toFixed(0)} rss_mb=${(rss / 1024 / 1024).toFixed(1)}`);
      lastSample = now;
      lastBytes = received;
    }
  });
  follow.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const deadline = Date.now() + durationSec * 1000;
  while (Date.now() < deadline && received < lines) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (writer.exitCode === null) writer.kill();
  const stopStartedAt = performance.now();
  // ssh -tt is not forced here; writing ETX still reaches the remote client on
  // OpenSSH builds that allocate a PTY through SSH_EXTRA_ARGS.
  follow.stdin.write("\x03");
  const followResult = await waitForExit(follow);
  const stopLatencyMs = performance.now() - stopStartedAt;
  const elapsedMs = (firstByteAt ?? performance.now()) - startedAt;

  console.log(JSON.stringify({
    received,
    expected: lines,
    firstByteLatencyMs: firstByteAt === null ? null : Number(elapsedMs.toFixed(1)),
    stopLatencyMs: Number(stopLatencyMs.toFixed(1)),
    peakRssMb: Number((peakRss / 1024 / 1024).toFixed(1)),
    followResult,
  }, null, 2));

  if (received < lines && Date.now() >= deadline) process.exitCode = 1;
  if (stopLatencyMs > 1000) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
