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
