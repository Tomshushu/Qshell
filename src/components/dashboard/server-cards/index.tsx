import { memo } from 'react'
import { useAppStore } from '@/store'
import type { ServerCardSkinProps } from './types'
import { DefaultServerCard } from './default-server-card'
import { AnimeCatServerCard } from './anime-cat-server-card'

/**
 * UI 风格专属服务器卡片注册表 (UI Style Server Card Registry)
 * 若风格未在此显式注册定制组件，则统一回退到 DefaultServerCard。
 * 未来扩展主题（如 ink 水墨卡、mecha 机甲卡、cyberpunk 全息卡等）可直接在此配置扩展。
 */
// 注册表组件可能带额外的 HTMLAttributes 透传 props，用 any 宽化以兼容不同皮肤组件签名
const STYLE_SERVER_CARD_MAP: Record<string, React.ComponentType<any>> = {
  anime: AnimeCatServerCard,
}

// ServerCardSkinProps.onSelect 与 HTMLAttributes.onSelect 同名但签名不同，
// 交叉会产生无法实现的函数类型，这里 Omit 掉 DOM 版 onSelect 保留业务签名
export const ServerCard = memo(function ServerCard(props: ServerCardSkinProps & Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'>) {
  const uiStyle = useAppStore(s => s.uiStyle)
  const CardComponent = STYLE_SERVER_CARD_MAP[uiStyle] || DefaultServerCard

  return <CardComponent {...props} />
})

export type { ServerCardProps, ServerCardSkinProps } from './types'
export { DefaultServerCard } from './default-server-card'
export { AnimeCatServerCard } from './anime-cat-server-card'
