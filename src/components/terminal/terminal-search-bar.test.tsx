import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TerminalSearchBar } from "./terminal-search-bar";
import type { SearchState } from "./terminal-types";

describe("TerminalSearchBar Dual-Focus & Enter Key Separation", () => {
  afterEach(cleanup);

  const defaultSearchState: SearchState = {
    resultIndex: 0,
    resultCount: 5,
    isSearching: false,
    isCapped: false,
  };

  it("does not render anything when open is false", () => {
    const { container } = render(
      <I18nProvider>
        <TerminalSearchBar
          open={false}
          searchText=""
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={vi.fn()}
          onFindNext={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(container.querySelector(".terminal-search-bar")).toBeNull();
  });

  it("renders search bar and input when open is true", () => {
    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="error"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={vi.fn()}
          onFindNext={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("error");
    expect(input).toBeDefined();
    expect(screen.getByText("1/5")).toBeDefined();
  });

  it("triggers onFindNext and prevents default/propagation on Enter key", () => {
    const handleFindNext = vi.fn();
    const handleFindPrev = vi.fn();
    const handleKeyDown = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="test"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={handleKeyDown}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("test");
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    const preventDefaultSpy = vi.spyOn(enterEvent, "preventDefault");
    const stopPropagationSpy = vi.spyOn(enterEvent, "stopPropagation");

    input.dispatchEvent(enterEvent);

    expect(handleFindNext).toHaveBeenCalledTimes(1);
    expect(handleFindPrev).not.toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("triggers onFindPrev and prevents default/propagation on Shift+Enter key", () => {
    const handleFindNext = vi.fn();
    const handleFindPrev = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="test"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("test");
    const shiftEnterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    const preventDefaultSpy = vi.spyOn(shiftEnterEvent, "preventDefault");
    const stopPropagationSpy = vi.spyOn(shiftEnterEvent, "stopPropagation");

    input.dispatchEvent(shiftEnterEvent);

    expect(handleFindPrev).toHaveBeenCalledTimes(1);
    expect(handleFindNext).not.toHaveBeenCalled();
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("triggers onClose and prevents default/propagation on Escape key", () => {
    const handleClose = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="test"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={vi.fn()}
          onFindNext={vi.fn()}
          onClose={handleClose}
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("test");
    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    const preventDefaultSpy = vi.spyOn(escEvent, "preventDefault");
    const stopPropagationSpy = vi.spyOn(escEvent, "stopPropagation");

    input.dispatchEvent(escEvent);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("does not trigger onFindNext when IME is composing (Chinese input method)", () => {
    const handleFindNext = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="ceshi"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={vi.fn()}
          onFindNext={handleFindNext}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("ceshi");
    fireEvent.keyDown(input, {
      key: "Enter",
      isComposing: true,
    });

    expect(handleFindNext).not.toHaveBeenCalled();
  });

  it("handles navigation buttons for Find Prev and Find Next", () => {
    const handleFindPrev = vi.fn();
    const handleFindNext = vi.fn();
    const handleClose = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText="hello"
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={handleClose}
        />
      </I18nProvider>,
    );

    const buttons = screen.getAllByRole("button");
    // Find prev button, find next button, and close button are present
    expect(buttons.length).toBeGreaterThanOrEqual(5);

    // Click Prev button (ArrowUp)
    fireEvent.click(buttons[buttons.length - 3]);
    expect(handleFindPrev).toHaveBeenCalledTimes(1);

    // Click Next button (ArrowDown)
    fireEvent.click(buttons[buttons.length - 2]);
    expect(handleFindNext).toHaveBeenCalledTimes(1);

    // Click Close button (X)
    fireEvent.click(buttons[buttons.length - 1]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onFocus when input receives focus", () => {
    const handleFocus = vi.fn();

    render(
      <I18nProvider>
        <TerminalSearchBar
          open={true}
          searchText=""
          onSearchTextChange={vi.fn()}
          searchState={defaultSearchState}
          searchRegex={false}
          onToggleRegex={vi.fn()}
          searchCaseSensitive={false}
          onToggleCaseSensitive={vi.fn()}
          searchWholeWord={false}
          onToggleWholeWord={vi.fn()}
          onKeyDown={vi.fn()}
          onFocus={handleFocus}
          onFindPrev={vi.fn()}
          onFindNext={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    expect(handleFocus).toHaveBeenCalled();
  });
});

