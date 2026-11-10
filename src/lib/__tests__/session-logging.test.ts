import { describe, it, expect } from "vitest";
import { stripAnsiForRecording } from "@/components/terminal/terminal-utils";
import type { SessionLoggingConfig } from "@/types";

describe("Session Logging & Plaintext Audit Export", () => {
  it("strips ANSI color, cursor, and OSC escapes cleanly from output stream", () => {
    // Simulated colored terminal prompt with bold, colors, and title OSC
    const ansiSample =
      "\x1b]0;user@server:~/\x07\x1b[1;32muser@server\x1b[0m:\x1b[1;34m~/\x1b[0m$ ls -la\r\n" +
      "\x1b[01;34mdrwxr-xr-x\x1b[0m 2 user user 4096 Nov 10 08:00 \x1b[01;34m.\x1b[0m\r\n" +
      "\x1b[01;34mdrwxr-xr-x\x1b[0m 4 user user 4096 Nov 10 07:50 \x1b[01;34m..\x1b[0m\r\n" +
      "-rw-r--r-- 1 user user  220 Nov 10 07:50 .bash_logout\r\n";

    const clean = stripAnsiForRecording(ansiSample);

    expect(clean).not.toContain("\x1b");
    expect(clean).not.toContain("\x07");
    expect(clean).toContain("user@server:~/$ ls -la\r\n");
    expect(clean).toContain("drwxr-xr-x 2 user user 4096 Nov 10 08:00 .\r\n");
    expect(clean).toContain("-rw-r--r-- 1 user user  220 Nov 10 07:50 .bash_logout\r\n");
  });

  it("handles macro expansion in session log filenames", () => {
    const interpolateFileName = (
      pattern: string,
      server: { name: string; host: string; username: string; port: number },
      termId: string,
      now: Date
    ) => {
      const yyyy = String(now.getFullYear());
      const MM = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const safeName = server.name.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");
      const safeHost = server.host.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");
      const safeUser = server.username.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");

      return pattern
        .replace(/%n/g, safeName)
        .replace(/%h/g, safeHost)
        .replace(/%u/g, safeUser)
        .replace(/%p/g, String(server.port))
        .replace(/%d/g, `${yyyy}${MM}${dd}`)
        .replace(/%t/g, `${hh}${mm}${ss}`)
        .replace(/%s/g, termId.slice(-8))
        .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");
    };

    const fixedDate = new Date(2026, 10, 10, 8, 30, 45); // Nov 10 2026 08:30:45
    const server = {
      name: "Prod/K8s:Master",
      host: "10.0.0.1",
      username: "ops-admin",
      port: 2222,
    };

    const pattern = "%n_%h_%u_%p_%d_%t_%s.log";
    const result = interpolateFileName(pattern, server, "term-12345678", fixedDate);

    expect(result).toBe("Prod_K8s_Master_10.0.0.1_ops-admin_2222_20261110_083045_12345678.log");
  });

  it("validates SessionLoggingConfig serialization", () => {
    const config: SessionLoggingConfig = {
      enabled: true,
      format: "plain",
      directory: "D:\\Logs\\Audit",
      fileNamePattern: "%n_%d.log",
    };

    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as SessionLoggingConfig;

    expect(parsed.enabled).toBe(true);
    expect(parsed.format).toBe("plain");
    expect(parsed.directory).toBe("D:\\Logs\\Audit");
    expect(parsed.fileNamePattern).toBe("%n_%d.log");
  });

  it("handles line timestamp injection without duplicating on fragmented chunks", () => {
    const injectTimestamps = (
      outputData: string,
      isStart: boolean,
      ts: string
    ): { output: string; atStart: boolean } => {
      const tsParts: string[] = [];
      let atStart = isStart;
      for (let i = 0; i < outputData.length; i++) {
        const ch = outputData[i];
        if (atStart && ch !== "\r" && ch !== "\n") {
          tsParts.push(ts);
          atStart = false;
        }
        tsParts.push(ch);
        if (ch === "\n") {
          atStart = true;
        }
      }
      return { output: tsParts.join(""), atStart };
    };

    const ts = "[08:30:00.123] ";

    // Chunk 1: Complete line
    const r1 = injectTimestamps("hello\r\n", true, ts);
    expect(r1.output).toBe("[08:30:00.123] hello\r\n");
    expect(r1.atStart).toBe(true);

    // Chunk 2: Fragmented line part 1
    const r2 = injectTimestamps("world ", true, ts);
    expect(r2.output).toBe("[08:30:00.123] world ");
    expect(r2.atStart).toBe(false);

    // Chunk 3: Fragmented line part 2 (should NOT inject timestamp again!)
    const r3 = injectTimestamps("continued\r\n", r2.atStart, ts);
    expect(r3.output).toBe("continued\r\n");
    expect(r3.atStart).toBe(true);

    // Chunk 4: Next line (should inject timestamp)
    const r4 = injectTimestamps("next line\r\n", r3.atStart, ts);
    expect(r4.output).toBe("[08:30:00.123] next line\r\n");
  });
});
