import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useOverflowTitle } from '../use-overflow-title'

describe('useOverflowTitle', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    cleanup()
    container.remove()
  })

  it('sets title attribute when text is overflowing', () => {
    renderHook(() => useOverflowTitle())

    const el = document.createElement('div')
    el.className = 'truncate'
    el.textContent = 'This is a very long file path that exceeds container'
    container.appendChild(el)

    // Mock dimensions so scrollWidth > clientWidth + 1
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(el, 'scrollWidth', { value: 250, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 20, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: 20, configurable: true })

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(el.getAttribute('title')).toBe('This is a very long file path that exceeds container')
    expect(el.getAttribute('data-auto-overflow-title')).toBe('true')
  })

  it('uses data-overflow-tooltip-text if present', () => {
    renderHook(() => useOverflowTitle())

    const el = document.createElement('div')
    el.className = 'truncate'
    el.textContent = 'short'
    el.dataset.overflowTooltipText = 'Custom full tooltip text'
    container.appendChild(el)

    Object.defineProperty(el, 'clientWidth', { value: 50, configurable: true })
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true })

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(el.getAttribute('title')).toBe('Custom full tooltip text')
  })

  it('preserves existing manual title and does not overwrite it', () => {
    renderHook(() => useOverflowTitle())

    const el = document.createElement('div')
    el.className = 'truncate'
    el.textContent = 'Some label'
    el.setAttribute('title', 'Manual Custom Title')
    container.appendChild(el)

    Object.defineProperty(el, 'clientWidth', { value: 50, configurable: true })
    Object.defineProperty(el, 'scrollWidth', { value: 120, configurable: true })

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(el.getAttribute('title')).toBe('Manual Custom Title')
    expect(el.hasAttribute('data-auto-overflow-title')).toBe(false)
  })

  it('removes generated title if content no longer overflows', () => {
    renderHook(() => useOverflowTitle())

    const el = document.createElement('div')
    el.className = 'truncate'
    el.textContent = 'Text'
    el.title = 'Old auto title'
    el.setAttribute('data-auto-overflow-title', 'true')
    container.appendChild(el)

    // Not overflowing
    Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true })
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 20, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: 20, configurable: true })

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(el.hasAttribute('title')).toBe(false)
    expect(el.hasAttribute('data-auto-overflow-title')).toBe(false)
  })
})
