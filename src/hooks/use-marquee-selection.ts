import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 框选（marquee/rubber-band）多选 hook
 *
 * 在容器空白处按住左键拖动，像 Windows 资源管理器一样拖出矩形框选条目：
 * - 命中判定：容器内匹配 itemSelector 的元素与选择框矩形相交
 * - Ctrl/Cmd + 拖动 = 在现有选中基础上追加；普通拖动 = 替换
 * - 拖动位移超过阈值（4px）才激活，不干扰单击行为
 * - mousemove/mouseup 挂在 window，拖出容器仍有效；滚动时按最后位置重算
 *
 * 用法：
 * 1. 把 containerRef 挂到列表滚动容器（已有 ref 可通过 containerRef 参数传入复用）
 * 2. 容器 onMouseDown={onMouseDown}
 * 3. 在容器内渲染 marquee 矩形（配合 MarqueeRect 组件，fixed 定位）
 * 4. 若容器有"点击空白清空选中"逻辑，在 click 处理器开头调用 consumeMarqueeClick()，
 *    返回 true 时跳过清空（框选结束瞬间会先触发一次 click）
 */
export function useMarqueeSelection(options: {
  /** 容器内可选中条目的选择器 */
  itemSelector: string
  /**
   * 拖拽手柄的选择器（如 '[data-drag-handle="true"]'）。
   * 若提供，仅点击在手柄上才阻止框选（交给文件拖拽）；
   * 点击在条目的其他属性列（大小、修改时间等空白区）可正常启动框选！
   */
  dragHandleSelector?: string
  /** 从命中元素提取选中 ID（如 dataset.serverId） */
  getItemId: (el: HTMLElement) => string
  /** 读取当前选中集合（Ctrl 追加模式的基线） */
  getSelection: () => Set<string>
  /** 更新选中集合 */
  setSelection: (ids: Set<string>) => void
  /** 复用调用方已有的容器 ref（如虚拟滚动的 scrollContainerRef） */
  containerRef?: React.RefObject<HTMLDivElement | null>
}) {
  const { itemSelector, getItemId, dragHandleSelector } = options
  // 回调走 ref，避免调用方每次渲染重建 hook 依赖；
  // 在 effect 中同步（而非渲染期赋值），符合 react-hooks/refs规则
  const getSelectionRef = useRef(options.getSelection)
  const setSelectionRef = useRef(options.setSelection)
  useEffect(() => {
    getSelectionRef.current = options.getSelection
    setSelectionRef.current = options.setSelection
  })

  const ownContainerRef = useRef<HTMLDivElement | null>(null)
  const containerRef = options.containerRef ?? ownContainerRef

  const startRef = useRef<{ x: number; y: number } | null>(null)
  const lastRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const activeRef = useRef(false)
  const additiveRef = useRef(false)
  const baseRef = useRef<Set<string>>(new Set())
  const suppressClickRef = useRef(false)
  // 框选矩形（client 坐标，fixed 定位渲染）
  const [marquee, setMarquee] = useState<{ left: number; top: number; w: number; h: number } | null>(null)

  // 位移超过该阈值才视为框选，避免与普通单击冲突
  const THRESHOLD = 4

  // 根据框选矩形（client 坐标）计算命中的条目并更新选中集
  const updateSelection = useCallback(
    (rect: { left: number; top: number; right: number; bottom: number }) => {
      const container = containerRef.current
      if (!container) return
      // 追加模式以按下时刻的选中集为基线；替换模式从空集开始
      const next = new Set(additiveRef.current ? baseRef.current : [])
      container.querySelectorAll<HTMLElement>(itemSelector).forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) {
          next.add(getItemId(el))
        }
      })
      setSelectionRef.current(next)
    },
    [containerRef, itemSelector, getItemId],
  )

  // 框选启动：在容器空白处或非拖拽手柄区域按下
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      // 若提供了 dragHandleSelector，仅点击在手柄（图标/文件名）上才阻止框选；
      // 若未提供，则保持旧行为：点击在任何 itemSelector 上都阻止框选
      const blockSelector = dragHandleSelector || itemSelector
      if (target.closest(blockSelector)) return
      // 避免在交互按钮、输入框、下拉菜单等原生组件上启动框选
      if (target.closest('input, button, [role="button"], a, select, textarea')) return

      startRef.current = { x: e.clientX, y: e.clientY }
      lastRectRef.current = null
      activeRef.current = false
      // Ctrl/Cmd 按住拖动 = 追加选择；否则替换当前选中
      additiveRef.current = e.ctrlKey || e.metaKey
      baseRef.current = new Set(getSelectionRef.current())
    },
    [itemSelector, dragHandleSelector],
  )

  // 全局 mousemove/mouseup：拖动中即使移出容器也能继续框选；
  // capture 阶段监听 scroll，拖动中滚动（滚轮/虚拟列表）时按最后位置重算命中
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = startRef.current
      if (!start) return
      if (!activeRef.current) {
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
        activeRef.current = true
        // 激活框选时清除原生文本选中高亮
        window.getSelection()?.removeAllRanges()
      }
      const rect = {
        left: Math.min(start.x, e.clientX),
        top: Math.min(start.y, e.clientY),
        right: Math.max(start.x, e.clientX),
        bottom: Math.max(start.y, e.clientY),
      }
      lastRectRef.current = rect
      setMarquee({ left: rect.left, top: rect.top, w: rect.right - rect.left, h: rect.bottom - rect.top })
      updateSelection(rect)

      // 边缘自动滚动：当框选拖拽接近容器上下边缘时自动滚动
      const container = containerRef.current
      if (activeRef.current && container) {
        const cRect = container.getBoundingClientRect()
        const SCROLL_ZONE = 28
        const SCROLL_SPEED = 14
        if (e.clientY > cRect.bottom - SCROLL_ZONE) {
          container.scrollTop += SCROLL_SPEED
        } else if (e.clientY < cRect.top + SCROLL_ZONE) {
          container.scrollTop -= SCROLL_SPEED
        }
      }
    }
    const finish = () => {
      if (!startRef.current) return
      // 框选结束后抑制紧随其后的 click，避免触发"点击空白清空选中"
      if (activeRef.current) suppressClickRef.current = true
      startRef.current = null
      activeRef.current = false
      lastRectRef.current = null
      setMarquee(null)
    }
    const onScroll = () => {
      if (activeRef.current && lastRectRef.current) {
        updateSelection(lastRectRef.current)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finish)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [updateSelection])

  /** 消费"框选刚结束"标志：click 处理器开头调用，返回 true 时应跳过清空选中 */
  const consumeMarqueeClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return true
    }
    return false
  }, [])

  return { containerRef, marquee, onMouseDown, consumeMarqueeClick }
}
