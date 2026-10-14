import React from 'react'
import { RefreshCw, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { renderFileIcon } from '../local-file-picker-utils'
import type { TreeNode } from './types'

interface FileDirectoryTreeProps {
  treeWidth: number
  treeRoot: TreeNode
  visibleTreeNodes: { node: TreeNode; depth: number }[]
  hasMoreTreeNodes: boolean
  expandedPaths: Set<string>
  currentPath: string
  onToggleTreeNode: (path: string) => void
  onRefreshRoot: () => void
  onStartResize: (e: React.MouseEvent) => void
  t: (key: string) => string
}

export function FileDirectoryTree({
  treeWidth,
  treeRoot,
  visibleTreeNodes,
  hasMoreTreeNodes,
  expandedPaths,
  currentPath,
  onToggleTreeNode,
  onRefreshRoot,
  onStartResize,
  t,
}: FileDirectoryTreeProps) {
  return (
    <>
      {/* Directory tree */}
      <div
        className="bg-card/95 rounded-xl border border-border/70 shadow-sm flex flex-col overflow-hidden shrink-0"
        style={{ width: `${treeWidth}px` }}
      >
        <div className="flex items-center justify-between px-2 py-1 border-b">
          <span className="text-sm font-medium">{t('fs_dir_tree')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRefreshRoot}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${treeRoot.loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1 px-1">
            {visibleTreeNodes.map(({ node, depth }) => {
              const isExpanded = expandedPaths.has(node.path)
              const isActive = currentPath === node.path
              return (
                <div
                  key={node.path}
                  className={cn(
                    'flex items-center gap-1.5 py-1 pr-2 rounded-md cursor-pointer hover:bg-accent/80 dark:hover:bg-accent/70',
                    isActive && 'bg-primary/20 dark:bg-primary/25 font-semibold text-foreground'
                  )}
                  style={{ paddingLeft: `${depth * 14 + 6}px` }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return
                    onToggleTreeNode(node.path)
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) {
                      onToggleTreeNode(node.path)
                    }
                  }}
                >
                  <span className="shrink-0">
                    {node.loading ? (
                      <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                    ) : isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  {renderFileIcon(
                    { name: node.name, path: node.path, isDirectory: true, size: 0, modified: '' },
                    'h-4 w-4'
                  )}
                  <span className="text-sm truncate">{node.name}</span>
                </div>
              )
            })}
            {hasMoreTreeNodes && (
              <div className="px-2 py-1 text-xs text-muted-foreground italic">
                ... 更多节点请展开子目录
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 分隔线拖拽手柄 */}
      <div
        className="relative w-1 flex-shrink-0 flex items-center justify-center cursor-col-resize select-none group z-10 -mx-0.5"
        onMouseDown={onStartResize}
      >
        <div className="w-0.5 h-10 rounded-full bg-border/60 transition-all group-hover:h-16 group-hover:w-1 group-hover:bg-primary/70 group-active:bg-primary" />
      </div>
    </>
  )
}
