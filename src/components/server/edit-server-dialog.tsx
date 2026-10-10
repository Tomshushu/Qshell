import React from 'react'
import { ServerFormDialog } from './server-form-dialog'

export interface EditServerDialogProps {
  open: boolean
  onClose: () => void
  serverId: string
  onSaved?: (serverId: string) => void
}

export function EditServerDialog({ open, onClose, serverId, onSaved }: EditServerDialogProps) {
  return (
    <ServerFormDialog
      open={open}
      onClose={onClose}
      mode="edit"
      serverId={serverId}
      onSaved={onSaved}
    />
  )
}
