import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AutomationPopover } from "../automation-popover";
import { Z_LAYER } from "@/lib/z-layer";
import { useModalStackStore } from "@/store/modal-stack-store";
import { useAppStore } from "@/store";
import { useShortcutStore } from "@/store/shortcut-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  loadAutomationScripts,
  loadMacroSequences,
  loadTriggerRules,
  saveAutomationScripts,
  saveMacroSequences,
  saveTriggerRules,
} from "@/lib/automation/storage";

describe("AutomationPopover & Keyboard Shortcut Isolation", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useModalStackStore.getState().reset();
    useShortcutStore.getState().resetAll();
    useAppStore.setState({
      servers: [
        {
          id: "srv-1",
          name: "Prod",
          host: "10.0.0.1",
          port: 22,
          username: "ops",
          protocol: "ssh",
          authType: "password",
        } as any,
      ],
      tabs: [
        {
          id: "tab-1",
          serverId: "srv-1",
          serverName: "Prod",
          module: "terminal",
          title: "Prod",
        },
      ],
      activeTabId: "tab-1",
      isAppLocked: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders dialog with Z_LAYER.POPUP, registers with useModalStack, closes on Escape, and blocks Mod+W/Mod+T while typing inside", () => {
    const closeTabListener = vi.fn();
    window.addEventListener("qshell:request-close-tab", closeTabListener);
    renderHook(() => useKeyboardShortcuts());

    render(
      <I18nProvider>
        <AutomationPopover tabId="tab-1" serverId="srv-1" />
      </I18nProvider>,
    );

    const triggerBtn = screen.getByRole("button", { name: /终端自动化工作台|Automation/i });
    fireEvent.click(triggerBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-automation-popover")).toBe("true");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.style.zIndex).toBe(String(Z_LAYER.POPUP));
    expect(useModalStackStore.getState().stack.length).toBe(1);

    // Typing inside an input inside the popover must NOT trigger Mod+W
    fireEvent.click(screen.getByRole("button", { name: /新建脚本|New Script/i }));
    const nameInput = screen.getByPlaceholderText(/脚本名称/i);
    nameInput.focus();
    const isMac = /Mac/i.test(navigator.userAgent);
    fireEvent.keyDown(nameInput, {
      key: "w",
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    });
    expect(closeTabListener).not.toHaveBeenCalled();

    // Pressing Escape closes the popover via useModalStack
    fireEvent.keyDown(window, { key: "Escape", bubbles: true, cancelable: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useModalStackStore.getState().stack.length).toBe(0);

    window.removeEventListener("qshell:request-close-tab", closeTabListener);
  });

  it("supports editing existing scripts, triggers, and multi-step macros", () => {
    saveAutomationScripts([
      {
        id: "sc-1",
        name: "Old Script",
        code: 'await screen.send("old");',
        updatedAt: 1,
      },
    ]);
    saveTriggerRules([
      {
        id: "tr-1",
        name: "Old Trigger",
        enabled: true,
        pattern: "OLD_PAT",
        actionType: "send_text",
        payload: "yes",
        cooldownMs: 100,
      },
    ]);
    saveMacroSequences([
      {
        id: "mc-1",
        name: "Old Macro",
        scope: "all",
        loopCount: 1,
        steps: [
          {
            id: "st-1",
            enabled: true,
            name: "Step 1",
            type: "ascii",
            payload: "echo 1",
            suffix: "\r",
            delayMs: 50,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(
      <I18nProvider>
        <AutomationPopover tabId="tab-1" serverId="srv-1" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /终端自动化工作台|Automation/i }));

    // Edit Script
    fireEvent.click(screen.getByRole("button", { name: /编辑|Edit/i }));
    const scriptNameInput = screen.getByDisplayValue("Old Script");
    fireEvent.change(scriptNameInput, { target: { value: "Updated Script" } });
    fireEvent.click(screen.getByRole("button", { name: /保存|Save/i }));
    expect(loadAutomationScripts()[0].name).toBe("Updated Script");

    // Edit Trigger
    fireEvent.click(screen.getByRole("button", { name: /触发器|Triggers/i }));
    fireEvent.click(screen.getByRole("button", { name: /编辑|Edit/i }));
    const patInput = screen.getByDisplayValue("OLD_PAT");
    fireEvent.change(patInput, { target: { value: "NEW_PAT" } });
    fireEvent.click(screen.getByRole("button", { name: /保存|Save/i }));
    expect(loadTriggerRules()[0].pattern).toBe("NEW_PAT");

    // Edit Multi-step Macro (add a second step)
    fireEvent.click(screen.getByRole("button", { name: /录制与宏|Macros/i }));
    fireEvent.click(screen.getByRole("button", { name: /编辑|Edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /添加步骤|Add Step/i }));
    const stepInputs = screen.getAllByPlaceholderText("uname -a");
    expect(stepInputs.length).toBe(2);
    fireEvent.change(stepInputs[1], { target: { value: "echo 2" } });
    fireEvent.click(screen.getByRole("button", { name: /保存|Save/i }));
    expect(loadMacroSequences()[0].steps.map((s) => s.payload)).toEqual(["echo 1", "echo 2"]);
  });
});
