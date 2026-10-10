import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TerminalModule } from "./terminal";

// Mock sshService and tauri apis
vi.mock("@/services/ssh-service", () => {
  const target: Record<string, any> = {
    listServers: vi.fn().mockResolvedValue([]),
    createShell: vi.fn().mockResolvedValue("session-1"),
    isSessionAlive: vi.fn().mockReturnValue(true),
  };
  const sshService = new Proxy(target, {
    get: (obj, prop: string) => {
      if (prop in obj) return obj[prop];
      if (prop.startsWith("on")) return vi.fn().mockReturnValue(() => {});
      return vi.fn().mockResolvedValue(undefined);
    },
  });
  return { sshService };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn().mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  stat: vi.fn().mockResolvedValue({ isFile: true, size: 0 }),
}));

// Mock ResizeObserver for jsdom
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("TerminalModule initialization", () => {
  it("mounts successfully without TDZ ReferenceErrors on toast or other hooks", () => {
    expect(() => {
      render(
        <I18nProvider>
          <TerminalModule
            serverId="server-1"
            isActive={true}
            isVisible={true}
            isConnected={true}
          />
        </I18nProvider>
      );
    }).not.toThrow();
  });
});
