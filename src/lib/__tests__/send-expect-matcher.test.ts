import { describe, expect, it, vi } from "vitest";
import {
  stripAnsiCodes,
  createSendExpectState,
  processSendExpectChunk,
  cleanupSendExpectState,
  interpolateMacros,
  parseSendSteps,
  mergeGlobalLogonConfig,
  resolveScriptParameters,
  redactSecretValues,
  ProgrammableScriptController,
} from "../send-expect-matcher";
import type { SendExpectRule, LogonScriptsConfig } from "@/types";

describe("stripAnsiCodes", () => {
  it("strips CSI color and formatting codes", () => {
    const raw = "\x1b[31;1m[sudo] password for user:\x1b[0m ";
    expect(stripAnsiCodes(raw)).toBe("[sudo] password for user: ");
  });

  it("strips OSC and cursor escape codes", () => {
    const raw = "\x1b]0;root@server:~\x07Welcome to Ubuntu 24.04\r\n";
    expect(stripAnsiCodes(raw)).toBe("Welcome to Ubuntu 24.04\r\n");
  });
});

describe("Macro Variables Interpolation", () => {
  it("interpolates %u, %h, %p, %n and date/time", () => {
    const ctx = {
      username: "admin_user",
      host: "192.168.1.100",
      port: 2222,
      serverName: "Prod-Gateway",
    };
    const template = "ssh %u@%h -p %p # Server: %n %%";
    const result = interpolateMacros(template, ctx);
    expect(result).toBe("ssh admin_user@192.168.1.100 -p 2222 # Server: Prod-Gateway %");
  });
});

describe("Send Steps & Delay Parsing", () => {
  it("parses pause tokens \\p and \\p500 with standard escapes", () => {
    const raw = "\\p500hello\\pworld\\r\\n";
    const steps = parseSendSteps(raw, 200, false);
    expect(steps).toEqual([
      { type: "pause", ms: 200 }, // rule delayMs
      { type: "pause", ms: 500 }, // \p500
      { type: "send", text: "hello" },
      { type: "pause", ms: 1000 }, // default \p is 1000ms
      { type: "send", text: "world\r\n" },
    ]);
  });

  it("automatically appends \\r if appendEnter is true", () => {
    const steps = parseSendSteps("ls -la", 0, true);
    expect(steps).toEqual([{ type: "send", text: "ls -la\r" }]);
  });
});

describe("Global Logon Scripts Merging", () => {
  it("merges global and server-specific rules when inheritGlobal is true", () => {
    const globalCfg: LogonScriptsConfig = {
      enabled: true,
      rules: [
        { id: "g1", expect: "fingerprint", send: "yes" },
      ],
    };
    const serverCfg: LogonScriptsConfig = {
      enabled: true,
      inheritGlobal: true,
      rules: [
        { id: "s1", expect: "password:", send: "secret" },
      ],
    };
    const merged = mergeGlobalLogonConfig(serverCfg, globalCfg);
    expect(merged?.enabled).toBe(true);
    expect(merged?.rules.length).toBe(2);
    expect(merged?.rules[0].id).toBe("g1");
    expect(merged?.rules[1].id).toBe("s1");
  });
});

describe("Send-Expect Engine", () => {
  const sampleConfig: LogonScriptsConfig = {
    enabled: true,
    rules: [
      {
        id: "rule-1",
        expect: "password:",
        send: "secret123",
        isSecret: true,
        sendEnter: true,
        once: true,
        delayMs: 150,
      },
      {
        id: "rule-2",
        expect: "/otp code:\\s*/i",
        send: "998877",
        isSecret: true,
        sendEnter: true,
        once: true,
      },
      {
        id: "rule-3",
        expect: "$",
        send: "source ~/.bashrc",
        isSecret: false,
        sendEnter: true,
        once: true,
      },
    ],
  };

  it("creates state correctly from valid JSON", () => {
    const state = createSendExpectState(JSON.stringify(sampleConfig));
    expect(state).toBeTruthy();
    expect(state?.rules.length).toBe(3);
    expect(state?.pendingRuleIds.size).toBe(3);
  });

  it("returns null for disabled or empty config", () => {
    expect(createSendExpectState(null)).toBeNull();
    expect(createSendExpectState(JSON.stringify({ enabled: false, rules: [] }))).toBeNull();
  });

  it("triggers rule upon substring match, parses steps, and unregisters once-only rule", () => {
    const state = createSendExpectState(JSON.stringify(sampleConfig))!;
    const triggers: Array<{ rule: SendExpectRule; steps: any[] }> = [];

    processSendExpectChunk(
      state,
      "\x1b[33m[sudo] Password:\x1b[0m ",
      (rule, steps) => triggers.push({ rule, steps })
    );

    expect(triggers.length).toBe(1);
    expect(triggers[0].rule.id).toBe("rule-1");
    expect(triggers[0].steps).toEqual([
      { type: "pause", ms: 150 },
      { type: "send", text: "secret123\r" },
    ]);
    expect(state.pendingRuleIds.has("rule-1")).toBe(false);

    // Subsequent output containing "password:" should NOT trigger again
    processSendExpectChunk(state, "password: ", (rule, steps) => triggers.push({ rule, steps }));
    expect(triggers.length).toBe(1);
  });

  it("triggers regex pattern match correctly", () => {
    const state = createSendExpectState(JSON.stringify(sampleConfig))!;
    const triggers: SendExpectRule[] = [];

    processSendExpectChunk(state, "Please enter OTP Code:   ", (rule) => triggers.push(rule));

    expect(triggers.length).toBe(1);
    expect(triggers[0].id).toBe("rule-2");
    expect(triggers[0].send).toBe("998877");
  });

  it("cleans up timers and state", () => {
    const state = createSendExpectState(JSON.stringify(sampleConfig))!;
    cleanupSendExpectState(state);
    expect(state.pendingRuleIds.size).toBe(0);
    expect(state.buffer).toBe("");
  });
});

describe("Programmable Script Controller (JS Engine)", () => {
  it("executes async interactive script with screen.waitForString and send", async () => {
    const sent: string[] = [];
    const controller = new ProgrammableScriptController(
      async (text) => {
        sent.push(text);
      },
      { username: "root", host: "1.2.3.4" }
    );

    const scriptPromise = controller.runScript(`
      if (await screen.waitForString("login:", 2000)) {
        await screen.send(session.username);
      }
      if (await screen.waitForString("password:", 2000)) {
        await screen.send("mypassword");
      }
    `);

    // Simulate terminal outputs arriving asynchronously
    controller.feedOutput("\r\nCentOS 9 login: ");
    await new Promise((r) => setTimeout(r, 20));

    expect(sent).toEqual(["root\r"]);

    controller.feedOutput("\r\nPassword: ");
    await scriptPromise;

    expect(sent).toEqual(["root\r", "mypassword\r"]);
  });

  it("interpolates %P{name} script parameters, %%P{name} escape, and exposes session.params", async () => {
    const ctx = {
      username: "deploy",
      host: "prod-1",
      params: { env: "staging", token: "sec-12345" },
    };

    expect(interpolateMacros("ENV=%P{env} TOKEN=%P{token} ESC=%%P{env} MISS=%P{missing}", ctx)).toBe(
      "ENV=staging TOKEN=sec-12345 ESC=%%P{env} MISS=".replace("%%", "%")
    );

    const resolved = resolveScriptParameters(
      [
        { name: "env", defaultValue: "dev" },
        { name: "token", defaultValue: "sec-12345", secret: true },
        { name: "region", required: true },
      ],
      { env: "staging" }
    );
    expect(resolved.params).toEqual({ env: "staging", token: "sec-12345", region: "" });
    expect(resolved.secretValues).toEqual(["sec-12345"]);
    expect(resolved.missingRequired.map((p) => p.name)).toEqual(["region"]);
    expect(redactSecretValues("auth token=sec-12345 ok", resolved.secretValues)).toBe(
      "auth token=****** ok"
    );

    const merged = mergeGlobalLogonConfig(
      {
        enabled: true,
        inheritGlobal: true,
        rules: [],
        parameters: [{ name: "env", defaultValue: "prod" }],
      },
      {
        enabled: true,
        rules: [],
        parameters: [
          { name: "env", defaultValue: "dev" },
          { name: "cluster", defaultValue: "ap-east" },
        ],
      }
    );
    expect(merged?.parameters).toEqual([
      { name: "env", defaultValue: "prod" },
      { name: "cluster", defaultValue: "ap-east" },
    ]);

    const sent: string[] = [];
    const ctrl = new ProgrammableScriptController(async (text) => {
      sent.push(text);
    }, ctx);
    await ctrl.runScript('await screen.send("deploy:" + session.params.env);');
    expect(sent).toEqual(["deploy:staging\r"]);
  });

  it("initializes Send-Expect state from globalConfig alone when server config is empty", () => {
    const globalCfg: LogonScriptsConfig = {
      enabled: true,
      rules: [
        {
          id: "global-1",
          expect: "login:",
          send: "%u",
          sendEnter: true,
          once: true,
        },
      ],
      parameters: [{ name: "env", defaultValue: "prod" }],
    };

    const state = createSendExpectState(null, { username: "ops" }, undefined, globalCfg);
    expect(state).not.toBeNull();
    expect(state?.rules.length).toBe(1);

    const triggers: Array<{ rule: SendExpectRule; steps: Array<{ type: string; text?: string }> }> = [];
    processSendExpectChunk(state!, "login: ", (rule, steps) => {
      triggers.push({ rule, steps });
    });
    expect(triggers.length).toBe(1);
    // parseSendSteps appends a single trailing \r when sendEnter !== false (no double \r)
    expect(triggers[0].steps).toEqual([{ type: "send", text: "ops\r" }]);
  });

  it("guards waitForString('') and invalid waitForRegex in ProgrammableScriptController", async () => {
    const ctrl = new ProgrammableScriptController(async () => {});
    const rt = ctrl.createRuntime();
    await expect(rt.screen.waitForString("", 100)).resolves.toBe(false);
    await expect(rt.screen.waitForStrings(["", ""], 100)).resolves.toBe(-1);
    await expect(rt.screen.waitForRegex("[unclosed", 100)).resolves.toBeNull();
    ctrl.abort();
  });
});
