import { useEffect } from 'react'

const OVERFLOW_SELECTOR = '.truncate, [class*="line-clamp-"], [data-overflow-tooltip="true"]'
const AUTO_TITLE_ATTRIBUTE = 'data-auto-overflow-title'

function findOverflowElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const element = target.closest(OVERFLOW_SELECTOR)
  return element instanceof HTMLElement ? element : null
}

function isOverflowing(element: HTMLElement): boolean {
  // 留出 1px，避免缩放或小数像素造成未省略文本被误判。
  return element.scrollWidth > element.clientWidth + 1
    || element.scrollHeight > element.clientHeight + 1
}

function clearGeneratedTitle(element: HTMLElement): void {
  if (!element.hasAttribute(AUTO_TITLE_ATTRIBUTE)) return
  element.removeAttribute('title')
  element.removeAttribute(AUTO_TITLE_ATTRIBUTE)
}

function syncOverflowTitle(event: Event): void {
  const element = findOverflowElement(event.target)
  if (!element) return

  if (!isOverflowing(element)) {
    clearGeneratedTitle(element)
    return
  }

  // 业务代码显式提供的 title 优先，不覆盖路径、错误等定制提示。
  if (element.hasAttribute('title') && !element.hasAttribute(AUTO_TITLE_ATTRIBUTE)) return

  const fullText = (element.dataset.overflowTooltipText || element.textContent || '').trim()
  if (!fullText) {
    clearGeneratedTitle(element)
    return
  }

  element.title = fullText
  element.setAttribute(AUTO_TITLE_ATTRIBUTE, 'true')
}

/**
 * 为全项目的省略文本提供原生悬停提示。
 * 使用事件委托，不为每个列表行创建监听器；虚拟列表和后续动态节点也自动生效。
 */
export function useOverflowTitle(): void {
  useEffect(() => {
    document.addEventListener('mouseover', syncOverflowTitle, true)
    document.addEventListener('focusin', syncOverflowTitle, true)
    return () => {
      document.removeEventListener('mouseover', syncOverflowTitle, true)
      document.removeEventListener('focusin', syncOverflowTitle, true)
    }
  }, [])
}
