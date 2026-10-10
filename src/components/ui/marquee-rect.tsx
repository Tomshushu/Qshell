/** 框选矩形（配合 useMarqueeSelection 使用）：client 坐标 fixed 定位，不拦截事件 */
export function MarqueeRect({ marquee }: { marquee: { left: number; top: number; w: number; h: number } | null }) {
  if (!marquee) return null
  return (
    <div
      className="fixed z-50 pointer-events-none rounded-sm border border-primary/70 bg-primary/10"
      style={{ left: marquee.left, top: marquee.top, width: marquee.w, height: marquee.h }}
    />
  )
}
