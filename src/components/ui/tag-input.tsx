import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

interface TagInputProps {
  tags: string[]
  allTags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ tags, allTags, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('tag_default_placeholder')
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 下拉方向检测: 下方空间不足时向上展开
  useLayoutEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    // 下拉框预估高度 160px + 4px gap
    setDropUp(spaceBelow < 164)
  }, [open])

  const filteredSuggestions = allTags.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())
  )

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (input.trim()) {
        addTag(input)
      }
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  // 输入框失焦时自动提交未完成的标签输入
  const handleBlur = () => {
    if (input.trim()) {
      addTag(input)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex flex-wrap gap-1 min-h-[36px] px-2 py-1.5 rounded-md border bg-transparent text-sm',
          'focus-within:ring-1 focus-within:ring-ring focus-within:border-primary',
          'cursor-text'
        )}
        onClick={() => {
          inputRef.current?.focus()
          setOpen(true)
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? resolvedPlaceholder : ''}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>

      {open && filteredSuggestions.length > 0 && (
        <div className={cn(
          'absolute z-50 w-full rounded-md border bg-popover p-1 shadow-md max-h-[160px] overflow-auto',
          dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
        )}>
          {filteredSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors"
              onClick={() => addTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
