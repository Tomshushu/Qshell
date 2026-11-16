/**
 * 菜单/浮层边界检测工具
 * 参考实现：docker.tsx renderMenu + terminal.tsx hintPanelStyle
 */

export interface MenuPosition {
  left: number
  top: number
}

export interface SubMenuPosition {
  left: number
  top: number
  /** 子菜单展开方向：right（向右）/ left（向左） */
  side: 'left' | 'right'
}

const PAD = 4 // 视口边距，避免菜单紧贴屏幕边缘

/**
 * 计算主菜单在视口内的安全位置（夹紧到视口内）
 * @param x 鼠标 clientX
 * @param y 鼠标 clientY
 * @param menuW 菜单预估宽度
 * @param menuH 菜单预估高度
 */
export function clampMenuToViewport(
  x: number,
  y: number,
  menuW: number,
  menuH: number
): MenuPosition {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = x + menuW > vw - PAD
    ? Math.max(PAD, vw - menuW - PAD)
    : x
  const top = y + menuH > vh - PAD
    ? Math.max(PAD, vh - menuH - PAD)
    : y
  return { left, top }
}

/**
 * 计算子菜单展开位置，右侧空间不足时自动向左展开
 * @param parentLeft 父菜单 left
 * @param parentTop 父菜单 top
 * @param parentW 父菜单宽度
 * @param subW 子菜单预估宽度
 * @param subH 子菜单预估高度
 * @param alignTop 子菜单顶部是否与父菜单顶部对齐（默认 true）
 */
export function computeSubMenuPosition(
  parentLeft: number,
  parentTop: number,
  parentW: number,
  subW: number,
  subH: number,
  alignTop = true
): SubMenuPosition {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 右侧剩余空间
  const rightSpace = vw - (parentLeft + parentW) - PAD
  const side: 'left' | 'right' = rightSpace >= subW + PAD ? 'right' : 'left'
  // 水平定位
  const left = side === 'right'
    ? parentLeft + parentW
    : Math.max(PAD, parentLeft - subW)
  // 垂直定位：默认与父菜单顶部对齐，下方空间不足时上移
  const top = alignTop
    ? (parentTop + subH > vh - PAD
        ? Math.max(PAD, vh - subH - PAD)
        : parentTop)
    : parentTop
  return { left, top, side }
}

/**
 * 计算下拉/弹出面板的垂直翻转
 * 当触发器下方空间不足时，向上展开
 * @param triggerRect 触发器的 getBoundingClientRect()
 * @param panelH 面板预估高度
 * @param gap 间距（默认 4）
 */
export function computeDropdownVerticalPosition(
  triggerRect: DOMRect,
  panelH: number,
  gap = 4
): { top: number; placeBelow: boolean } {
  const vh = window.innerHeight
  const spaceBelow = vh - triggerRect.bottom - gap
  const placeBelow = spaceBelow >= panelH || spaceBelow >= triggerRect.top
  const top = placeBelow
    ? triggerRect.bottom + gap
    : Math.max(PAD, triggerRect.top - panelH - gap)
  return { top, placeBelow }
}

/**
 * 计算二级/嵌套悬停子菜单的纵向偏移量（相对于触发项容器 top）与最大可用高度：
 * 当触发项靠近视口底部导致子菜单向下溢出时，自动向上收拢，确保不超出屏幕边界。
 */
export function computeSubmenuVerticalClamp(
  triggerTop: number,
  panelHeight: number,
  padding = 6,
  initialOffset = -4
): { offsetTop: number; maxHeight: number } {
  if (typeof window === 'undefined' || window.innerHeight <= 0) {
    return { offsetTop: initialOffset, maxHeight: Math.max(120, panelHeight) }
  }
  const vh = window.innerHeight
  const maxHeight = Math.max(120, vh - padding * 2)
  const effectiveH = Math.min(panelHeight, maxHeight)
  const clampedTop = Math.max(
    padding,
    Math.min(triggerTop + initialOffset, vh - effectiveH - padding)
  )
  return {
    offsetTop: Math.round(clampedTop - triggerTop),
    maxHeight,
  }
}

/**
 * 计算 Portal 固定定位下拉浮层的视口安全坐标与最大高度：
 * 下方空间不足时自动翻转为向上展开，并结合视口边界限制 maxHeight 以免底部/顶部截断。
 */
export function computeFloatingPopoverPosition(
  triggerRect: DOMRect,
  panelW: number,
  panelH: number,
  padding = 8,
  gap = 4
): { left: number; top: number; placeBelow: boolean; maxHeight: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(padding, Math.min(triggerRect.left, vw - panelW - padding))
  const spaceBelow = Math.max(0, vh - triggerRect.bottom - gap - padding)
  const spaceAbove = Math.max(0, triggerRect.top - gap - padding)
  const placeBelow = spaceBelow >= panelH || spaceBelow >= spaceAbove
  const availableH = placeBelow ? spaceBelow : spaceAbove
  const maxHeight = Math.max(120, Math.min(panelH, availableH))
  const effectiveH = Math.min(panelH, maxHeight)
  const top = placeBelow
    ? triggerRect.bottom + gap
    : Math.max(padding, triggerRect.top - effectiveH - gap)
  return { left, top, placeBelow, maxHeight }
}
