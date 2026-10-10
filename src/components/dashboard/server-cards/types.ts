import type { Server as ServerType } from '@/types'

export interface ServerCardProps {
  server: ServerType
  selected: boolean
  selectedCount: number
  selectedServerIds: Set<string>
  onSelect: (serverId: string, ctrlKey: boolean) => void
  onBatchOpenSameWorkspace: () => void
  onBatchOpenSeparate: () => void
  onBatchOpenSftp: () => void
  onBatchOpenFilesSplit: () => void
  onClearSelection: () => void
  onBatchDelete: () => void
  onRename: (s: ServerType) => void
  onDelete: (s: ServerType) => void
  onEdit: (id: string) => void
  renamingServerId: string | null
  renameValue: string
  onRenameValueChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
}

export interface ServerCardSkinProps {
  server: ServerType
  selected: boolean
  onSelect: (serverId: string, ctrlKey: boolean) => void
  renamingServerId: string | null
  renameValue: string
  onRenameValueChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
}
