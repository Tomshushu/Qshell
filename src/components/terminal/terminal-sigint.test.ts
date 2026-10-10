import { describe, it, expect } from "vitest";
import { findSigintBoundary } from "./terminal-utils";

describe("findSigintBoundary", () => {
  it("returns -1 for empty or null string", () => {
    expect(findSigintBoundary("")).toBe(-1);
  });

  it("returns -1 for normal log output without interrupt markers", () => {
    expect(findSigintBoundary("Oct  6 06:00:00 server systemd[1]: Started Docker Application Container Engine.\n")).toBe(-1);
    expect(findSigintBoundary("2026-10-06 06:00:01.123 INFO [main] com.example.Application - Started\n")).toBe(-1);
  });

  it("detects ^C at the start of output", () => {
    expect(findSigintBoundary("^C\r\nuser@host:~$ ")).toBe(0);
  });

  it("detects ^C in the middle of in-flight logs and returns correct offset", () => {
    const text = "previous log line 1\nprevious log line 2\n^C\r\nuser@host:~$ ";
    const offset = findSigintBoundary(text);
    expect(offset).toBe(40);
    expect(text.slice(offset)).toBe("^C\r\nuser@host:~$ ");
  });

  it("detects \\x03 ETX marker", () => {
    const text = "stale logs\x03\r\nuser@host:~$ ";
    const offset = findSigintBoundary(text);
    expect(offset).toBe(10);
    expect(text.slice(offset)).toBe("\x03\r\nuser@host:~$ ");
  });

  it("detects bracketed paste mode off sequence \\x1b[?2004l", () => {
    const text = "in-flight log output\x1b[?2004l^C\r\nuser@host:~$ ";
    const offset = findSigintBoundary(text);
    expect(offset).toBe(20);
  });

  it("detects OSC window title sequence at prompt redraw", () => {
    const text = "server output log\x1b]0;user@server: ~\x07root@server:~# ";
    const offset = findSigintBoundary(text);
    expect(offset).toBe(17);
  });

  it("picks the earliest marker when multiple markers are present", () => {
    const text = "logs...\x1b[?2004l\r\n^C\r\n\x1b]0;host\x07$ ";
    const offset = findSigintBoundary(text);
    expect(offset).toBe(7);
  });

  it("does not treat \\x1b[2K progress bar line clears as sigint boundary", () => {
    expect(findSigintBoundary("\x1b[2K[1/5] Downloading docker layers...\r")).toBe(-1);
    expect(findSigintBoundary("progress: 50% \x1b[2K\rprogress: 60%")).toBe(-1);
    expect(findSigintBoundary("\x1b[2K\r\x1b[32m✔\x1b[0m Compiled successfully\n")).toBe(-1);
  });
});
