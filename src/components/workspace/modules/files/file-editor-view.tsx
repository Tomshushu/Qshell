import React from 'react'
import {
  ArrowUp,
  Eye,
  Pencil,
  Braces,
  Shield,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { MarkdownViewer } from '@/components/ui/markdown-viewer'
import { HTML_EXT_SET } from '../local-file-picker-utils'

interface FileEditorViewProps {
  editingFile: string
  editContent: string
  setEditContent: (val: string) => void
  editLoading: boolean
  editMode: 'edit' | 'preview'
  setEditMode: React.Dispatch<React.SetStateAction<'edit' | 'preview'>>
  onBack: () => void
  onSave: () => void
  onBackup: (path: string) => void
  onFormatJsonSuccess: (isMultiLine: boolean) => void
  onFormatJsonError: (errMsg: string) => void
  t: (key: string) => string
}

export function FileEditorView({
  editingFile,
  editContent,
  setEditContent,
  editLoading,
  editMode,
  setEditMode,
  onBack,
  onSave,
  onBackup,
  onFormatJsonSuccess,
  onFormatJsonError,
  t,
}: FileEditorViewProps) {
  const editExt = editingFile.split('.').pop()?.toLowerCase() || ''
  const isMarkdown = editExt === 'md' || editExt === 'markdown'
  const isHtml = HTML_EXT_SET.has(editExt)
  const hasPreviewMode = isMarkdown || isHtml

  const handleFormatJson = () => {
    if (!editContent) return
    try {
      const parsed = JSON.parse(editContent)
      const isMultiLine = editContent.includes('\n')
      const formatted = isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)
      setEditContent(formatted)
      onFormatJsonSuccess(isMultiLine)
    } catch (err) {
      onFormatJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
        <Button variant="ghost" size="sm" className="h-8 text-sm gap-1" onClick={onBack}>
          <ArrowUp className="h-4 w-4" />
          {t('fs_back')}
        </Button>
        <span className="text-sm text-muted-foreground truncate">{editingFile}</span>
        <div className="flex-1" />
        {hasPreviewMode && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm gap-1"
            onClick={() => setEditMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
          >
            {editMode === 'edit' ? (
              <>
                <Eye className="h-4 w-4" />
                <span>{t('sftp_viewer_preview')}</span>
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" />
                <span>{t('sftp_viewer_edit')}</span>
              </>
            )}
          </Button>
        )}
        {editExt === 'json' && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm gap-1"
            onClick={handleFormatJson}
            title="格式化 JSON (缩进排版 / 紧凑排版)"
          >
            <Braces className="h-4 w-4 text-primary" />
            <span>格式化</span>
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-8 text-sm gap-1" onClick={() => onBackup(editingFile)}>
          <Shield className="h-4 w-4" />
          {t('fs_create_backup')}
        </Button>
        <Button size="sm" className="h-8 text-sm" disabled={editLoading} onClick={onSave}>
          {t('fs_save')}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        {editLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">{t('fs_loading_content')}</span>
          </div>
        ) : isMarkdown && editMode === 'preview' ? (
          <div className="h-full overflow-auto bg-card">
            <MarkdownViewer content={editContent} />
          </div>
        ) : isHtml && editMode === 'preview' ? (
          <div className="h-full bg-white">
            <iframe
              srcDoc={editContent}
              title={editingFile}
              sandbox="allow-same-origin allow-scripts"
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          <CodeEditor
            value={editContent}
            onValueChange={setEditContent}
            fileName={editingFile}
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}
