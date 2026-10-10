import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PatternLock } from "@/components/ui/pattern-lock";
import {
  patternToKey,
  hashAppLockPassword,
  verifyAppLockPassword,
  INTERMEDIATE_POINTS,
} from "@/lib/app-lock";

describe("Pattern Lock (九点手势图案锁)", () => {
  afterEach(cleanup);
  it("converts pattern index array to key and hashes correctly", async () => {
    const pattern = [0, 1, 2, 4, 6, 7, 8];
    const key = patternToKey(pattern);
    expect(key).toBe("pattern:0-1-2-4-6-7-8");

    const hash = await hashAppLockPassword(key);
    expect(hash).toHaveLength(64);

    const isMatch = await verifyAppLockPassword(key, hash);
    expect(isMatch).toBe(true);

    const isWrong = await verifyAppLockPassword("pattern:0-1-2", hash);
    expect(isWrong).toBe(false);
  });

  it("verifies intermediate points bridging map", () => {
    expect(INTERMEDIATE_POINTS["0-2"]).toBe(1);
    expect(INTERMEDIATE_POINTS["2-0"]).toBe(1);
    expect(INTERMEDIATE_POINTS["0-8"]).toBe(4);
    expect(INTERMEDIATE_POINTS["3-5"]).toBe(4);
    expect(INTERMEDIATE_POINTS["6-8"]).toBe(7);
  });

  it("renders 9 dots on the pattern grid", () => {
    render(<PatternLock />);
    for (let i = 0; i < 9; i++) {
      expect(screen.getByTestId(`pattern-dot-${i}`)).toBeDefined();
    }
  });

  it("fires onStart and onComplete when drawing a pattern", () => {
    const handleStart = vi.fn();
    const handleComplete = vi.fn();

    const { getByTestId } = render(
      <PatternLock onStart={handleStart} onComplete={handleComplete} size={300} />,
    );

    const svg = getByTestId("pattern-lock-svg");

    // Mock getBoundingClientRect on SVG element
    svg.getBoundingClientRect = vi.fn(() => ({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // Dot 0 is at (60, 60)
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 60, button: 0 });
    expect(handleStart).toHaveBeenCalled();

    // Move to Dot 1 at (150, 60)
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 60 });

    // Move to Dot 2 at (240, 60)
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 60 });

    // Pointer up to complete
    fireEvent.pointerUp(svg);
    expect(handleComplete).toHaveBeenCalledWith([0, 1, 2]);
  });

  it("bridges intermediate dots when jumping over them", () => {
    const handleComplete = vi.fn();

    const { getByTestId } = render(
      <PatternLock onComplete={handleComplete} size={300} />,
    );

    const svg = getByTestId("pattern-lock-svg");
    svg.getBoundingClientRect = vi.fn(() => ({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // Start at Dot 0 (60, 60)
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 60, button: 0 });

    // Jump directly to Dot 2 (240, 60) over Dot 1
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 60 });

    fireEvent.pointerUp(svg);
    // Should automatically have bridged point 1: [0, 1, 2]
    expect(handleComplete).toHaveBeenCalledWith([0, 1, 2]);
  });
});
