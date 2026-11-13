/**
 * 全局浮层分层契约（single source of truth 的数字部分）。
 *
 * 与 `src/index.css` 里的 `@theme --z-*` / `@utility z-*` 一一对应：
 * - className 用语义类：`z-modal` / `z-modal-content` / `z-popup` / …
 * - inline style / store 用这里的数字常量：`Z_LAYER.MODAL` / …
 *
 * 分层是「类别之间的硬边界」，不是数值军备竞赛：
 *   布局 0~29 < 页面内浮层 30~49 < 窗口 60~99 < 模态 200~299
 *   < 菜单/下拉 300~399 < 拖拽 400~499 < Toast 900 < 应用锁 9999
 *
 * 注：Tailwind 内置的 z-0 ~ z-50 仍可用于「页面内局部层叠」（终端画布、
 * 导航栏、弹框内部元素等）。它们要么被祖先的层叠上下文圈住，要么本就该在
 * 模态打开时被遮住，不参与上表的 body 级分层。只写 `fixed` / Portal 到 body
 * 的浮层才需要引用这里的语义类。
 *
 * 硬约束：
 * 1. 点击窗口置顶只在 WINDOW_BASE~WINDOW_MAX 内生效，永远不会越过 MODAL。
 *    因此「新打开的模态一定在所有窗口之上」由数值区间保证。
 * 2. 菜单层高于模态层，保证弹框内部的下拉/右键菜单不被自己的遮罩盖住。
 * 3. Toast / 应用锁高于所有业务浮层；拖拽 ghost 不得高于应用锁。
 *
 * 修改任一数值时，务必同步 `src/index.css` 的 `--z-*` 变量。
 */
export const Z_LAYER = {
  /** 布局 / 局部层叠 0~29 */
  LAYOUT: 0,
  /** 终端、页面内的 absolute 浮层 30~49（模态打开时应被遮住） */
  INLINE: 30,
  /** 可交互浮窗动态栈 60~99，见 store/window-layer-store.ts */
  WINDOW_BASE: 60,
  WINDOW_MAX: 99,
  /** 模态遮罩 200~299 */
  MODAL: 200,
  /** 模态内容：比遮罩高 1，避免依赖 Portal 的 DOM 先后顺序 */
  MODAL_CONTENT: 201,
  /** 模态内部的拖拽防穿透层（仍低于菜单层） */
  MODAL_GUARD: 250,
  /** 下拉 / 右键菜单 / tooltip / hover 预览 300~399 */
  POPUP: 300,
  /** 菜单内的二级浮层（如颜色选择器 hover 提示、主题预览） */
  POPUP_NESTED: 301,
  /** 拖拽 ghost / 框选矩形 400~499 */
  DRAG: 400,
  /** 全局通知 */
  TOAST: 900,
  /** 离席锁屏：最高层，任何业务浮层都不得越过 */
  LOCK: 9999,
} as const

export type ZLayerKey = keyof typeof Z_LAYER
