import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampMenuToViewport,
  computeSubMenuPosition,
  computeDropdownVerticalPosition,
} from './menu-position'

describe('menu-position utility', () => {
  beforeEach(() => {
    // Set standard viewport dimensions
    window.innerWidth = 1000
    window.innerHeight = 800
  })

  describe('clampMenuToViewport', () => {
    it('keeps coordinates if menu fits inside viewport', () => {
      const pos = clampMenuToViewport(100, 100, 200, 150)
      expect(pos).toEqual({ left: 100, top: 100 })
    })

    it('clamps left when overflowing on right edge', () => {
      // x=900, menuW=200, vw=1000 -> overflows
      const pos = clampMenuToViewport(900, 100, 200, 150)
      // vw - menuW - PAD = 1000 - 200 - 4 = 796
      expect(pos.left).toBe(796)
      expect(pos.top).toBe(100)
    })

    it('clamps top when overflowing on bottom edge', () => {
      // y=700, menuH=200, vh=800 -> overflows
      const pos = clampMenuToViewport(100, 700, 200, 200)
      // vh - menuH - PAD = 800 - 200 - 4 = 596
      expect(pos.left).toBe(100)
      expect(pos.top).toBe(596)
    })
  })

  describe('computeSubMenuPosition', () => {
    it('expands to the right when space permits', () => {
      const pos = computeSubMenuPosition(100, 100, 150, 120, 100)
      expect(pos.side).toBe('right')
      // parentLeft + parentW = 100 + 150 = 250
      expect(pos.left).toBe(250)
      expect(pos.top).toBe(100)
    })

    it('flips to the left when right space is insufficient', () => {
      // parentLeft=800, parentW=150 -> right edge is at 950, only 50px left (subW=120)
      const pos = computeSubMenuPosition(800, 100, 150, 120, 100)
      expect(pos.side).toBe('left')
      // parentLeft - subW = 800 - 120 = 680
      expect(pos.left).toBe(680)
    })
  })

  describe('computeDropdownVerticalPosition', () => {
    it('places below when space below is sufficient', () => {
      const rect = {
        top: 100,
        bottom: 140,
        left: 50,
        right: 150,
        width: 100,
        height: 40,
        x: 50,
        y: 100,
        toJSON: () => {},
      } as DOMRect

      const pos = computeDropdownVerticalPosition(rect, 200, 4)
      expect(pos.placeBelow).toBe(true)
      expect(pos.top).toBe(144)
    })

    it('flips above when space below is insufficient', () => {
      const rect = {
        top: 700,
        bottom: 740,
        left: 50,
        right: 150,
        width: 100,
        height: 40,
        x: 50,
        y: 700,
        toJSON: () => {},
      } as DOMRect

      // vh=800, spaceBelow=800-740-4=56 < 200
      const pos = computeDropdownVerticalPosition(rect, 200, 4)
      expect(pos.placeBelow).toBe(false)
      // top - panelH - gap = 700 - 200 - 4 = 496
      expect(pos.top).toBe(496)
    })
  })
})
