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
const STYLE_SERVER_CARD_MAP: Record<string, React.ComponentType<ServerCardSkinProps>> = {
  anime: AnimeCatServerCard,
}

export const ServerCard = memo(function ServerCard(props: ServerCardSkinProps & React.HTMLAttributes<HTMLDivElement>) {
  const uiStyle = useAppStore(s => s.uiStyle)
  const CardComponent = (STYLE_SERVER_CARD_MAP[uiStyle] || DefaultServerCard) as React.ComponentType<any>

  return <CardComponent {...props} />
})

export type { ServerCardProps, ServerCardSkinProps } from './types'
export { DefaultServerCard } from './default-server-card'
export { AnimeCatServerCard } from './anime-cat-server-card'
