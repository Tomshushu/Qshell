import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SelectPopover } from '../select-popover'

const options = Array.from({ length: 60 }, (_, i) => ({
  value: `model-${i}`,
  label: `model-${i}`,
}))

describe('SelectPopover wheel scrolling', () => {
  afterEach(() => cleanup())

  it('scrolls the option list with the mouse wheel when the default scroll is blocked', () => {
    render(
      <SelectPopover
        value={null}
        onChange={() => {}}
        options={options}
        placeholder="选择模型"
        searchable
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    const list = screen.getByTestId('select-popover-list')

    fireEvent.wheel(list, { deltaY: 120 })
    expect(list.scrollTop).toBe(120)

    fireEvent.wheel(list, { deltaY: -40 })
    expect(list.scrollTop).toBe(80)
  })
})
