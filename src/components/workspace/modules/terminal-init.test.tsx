import { describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { useAppStore } from "@/store";
import { sshService } from "@/services/ssh-service";
import { TerminalModule } from "./terminal";

// Mock sshService and tauri apis
vi.mock("@/services/ssh-service", () => {
  const target: Record<string, any> = {
    listServers: vi.fn().mockResolvedValue([]),
    connect: vi.fn().mockResolvedValue({ success: true }),
    createShell: vi.fn().mockResolvedValue({ success: true, sessionId: "session-1" }),
    createLocalShell: vi.fn().mockResolvedValue({ success: true, sessionId: "local-1" }),
    getHomeDirectory: vi.fn().mockResolvedValue("/root"),
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
    cleanup();
  });

  it("mounts ephemeral local terminal tab without Maximum update depth exceeded or SSH home lookup", () => {
    vi.clearAllMocks();
    const tabId = "__local__:pwsh-terminal-test";
    useAppStore.setState({
      tabs: [
        {
          id: tabId,
          serverId: "__local__:pwsh",
          serverName: "PowerShell",
          module: "terminal",
          title: "PowerShell",
          localProfileId: "pwsh",
        },
      ],
      activeTabId: tabId,
    });

    expect(() => {
      render(
        <I18nProvider>
          <TerminalModule
            serverId="__local__:pwsh"
            tabId={tabId}
            isActive={true}
            isVisible={true}
            isConnected={false}
          />
        </I18nProvider>
      );
    }).not.toThrow();

    expect(sshService.getHomeDirectory).not.toHaveBeenCalled();
    cleanup();
  });

  it("opens bottom SFTP panel via onOpenSftpPanel and falls back to openSftpWithServers on right-click", () => {
    vi.clearAllMocks();
    const openSftpSpy = vi.fn();
    const switchModuleSpy = vi.fn();
    useAppStore.setState({
      servers: [
        {
          id: "ssh-1",
          name: "Prod",
          host: "10.0.0.1",
          port: 22,
          username: "ubuntu",
          protocol: "ssh",
          authType: "password",
        } as any,
      ],
      tabs: [
        {
          id: "tab-ssh-1",
          serverId: "ssh-1",
          serverName: "Prod",
          module: "terminal",
          title: "Prod",
        },
      ],
      activeTabId: "tab-ssh-1",
      openSftpWithServers: openSftpSpy,
      switchModule: switchModuleSpy,
    });

    const onOpenSftpPanel = vi.fn();
    const { container, rerender } = render(
      <I18nProvider>
        <TerminalModule
          serverId="ws:ssh-1:tab-ssh-1"
          tabId="tab-ssh-1"
          isActive={true}
          isVisible={true}
          isConnected={true}
          onOpenSftpPanel={onOpenSftpPanel}
        />
      </I18nProvider>,
    );

    const viewport = container.querySelector('[data-terminal-viewport="true"]') as HTMLElement;
    expect(viewport).toBeTruthy();
    fireEvent.contextMenu(viewport, { clientX: 120, clientY: 120 });
    fireEvent.click(screen.getByText(/打开文件管理器 \(工作台\)|Open File Manager \(Workspace\)/));
    expect(onOpenSftpPanel).toHaveBeenCalledTimes(1);
    expect(openSftpSpy).not.toHaveBeenCalled();

    // Direct SFTP / FTP tab action works even when inline onOpenSftpPanel exists
    fireEvent.contextMenu(viewport, { clientX: 120, clientY: 120 });
    fireEvent.click(screen.getByTestId("terminal-menu-open-sftp-tab"));
    expect(openSftpSpy).toHaveBeenCalledTimes(1);
    expect(openSftpSpy).toHaveBeenCalledWith(["ssh-1"]);

    openSftpSpy.mockClear();
    switchModuleSpy.mockClear();

    rerender(
      <I18nProvider>
        <TerminalModule
          serverId="ws:ssh-1:tab-ssh-1"
          tabId="tab-ssh-1"
          isActive={true}
          isVisible={true}
          isConnected={true}
        />
      </I18nProvider>,
    );

    fireEvent.contextMenu(viewport, { clientX: 120, clientY: 120 });
    fireEvent.click(screen.getByText(/打开文件管理器 \(工作台\)|Open File Manager \(Workspace\)/));
    expect(switchModuleSpy).toHaveBeenCalledTimes(1);
    expect(switchModuleSpy).toHaveBeenCalledWith("tab-ssh-1", "files");
    expect(openSftpSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it("forwards resolved terminal home/cwd directory to openSftpWithServers when opening SFTP/FTP tab", async () => {
    vi.clearAllMocks();
    const originalMatchMedia = window.matchMedia;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(Date.now()), 0)) as typeof requestAnimationFrame;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 8 })),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      drawImage: vi.fn(),
      setTransform: vi.fn(),
      canvas: {},
    }) as any;
    const openSftpSpy = vi.fn();
    useAppStore.setState({
      servers: [
        {
          id: "ssh-1",
          name: "Prod",
          host: "10.0.0.1",
          port: 22,
          username: "ubuntu",
          protocol: "ssh",
          authType: "password",
        } as any,
      ],
      tabs: [
        {
          id: "tab-ssh-1",
          serverId: "ssh-1",
          serverName: "Prod",
          module: "terminal",
          title: "Prod",
        },
      ],
      activeTabId: "tab-ssh-1",
      openSftpWithServers: openSftpSpy,
    });

    try {
      const { container } = render(
        <I18nProvider>
          <TerminalModule
            serverId="ws:ssh-1:tab-ssh-1"
            tabId="tab-ssh-1"
            isActive={true}
            isVisible={true}
            isConnected={true}
            onOpenSftpPanel={vi.fn()}
          />
        </I18nProvider>,
      );

      // Wait for initial async home directory resolution (/root in mock)
      await vi.waitFor(
        () => {
          expect(sshService.getHomeDirectory).toHaveBeenCalledWith("ws:ssh-1:tab-ssh-1");
        },
        { timeout: 5000 },
      );

      const viewport = container.querySelector('[data-terminal-viewport="true"]') as HTMLElement;
      fireEvent.contextMenu(viewport, { clientX: 120, clientY: 120 });
      fireEvent.click(screen.getByTestId("terminal-menu-open-sftp-tab"));

      expect(openSftpSpy).toHaveBeenCalledTimes(1);
      expect(openSftpSpy).toHaveBeenCalledWith(["ssh-1"], { "ssh-1": "/root" });
    } finally {
      cleanup();
      window.matchMedia = originalMatchMedia;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      globalThis.requestAnimationFrame = originalRaf;
    }
  });
});
