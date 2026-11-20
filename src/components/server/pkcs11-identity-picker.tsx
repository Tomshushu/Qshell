import { useState } from 'react'
import { KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sshService } from '@/services/ssh-service'
import type { Pkcs11IdentityInfo } from '@/services/api/types'
import { cn } from '@/lib/utils'

interface Pkcs11IdentityPickerProps {
  libraryPath: string
  pin?: string
  selectedValue: string
  onSelect: (identity: string) => void
  tr: (zh: string, en: string) => string
}

/**
 * 扫描并选择 PKCS#11 智能卡 / 硬件令牌中的可用密钥（CKA_LABEL / CKA_ID）
 */
export function Pkcs11IdentityPicker({
  libraryPath,
  pin,
  selectedValue,
  onSelect,
  tr,
}: Pkcs11IdentityPickerProps) {
  const [scanning, setScanning] = useState(false)
  const [identities, setIdentities] = useState<Pkcs11IdentityInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleScan = async () => {
    const trimmed = libraryPath.trim()
    if (!trimmed) {
      setError(tr('请先填写 PKCS#11 驱动库路径', 'Please specify a PKCS#11 library path first'))
      setIdentities(null)
      return
    }
    setScanning(true)
    setError(null)
    try {
      const list = await sshService.listPkcs11Identities(trimmed, pin || undefined)
      setIdentities(list)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || tr('扫描智能卡密钥失败', 'Failed to scan PKCS#11 identities'))
      setIdentities(null)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={scanning || !libraryPath.trim()}
          className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
        >
          {scanning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span>{scanning ? tr('扫描中...', 'Scanning...') : tr('扫描硬件密钥', 'Scan Token Keys')}</span>
        </Button>
        {identities && (
          <span className="text-[11px] text-muted-foreground">
            {tr(`共发现 ${identities.length} 个密钥`, `${identities.length} key(s) found`)}
          </span>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-destructive break-all">{error}</p>
      )}

      {identities && identities.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {tr('未在当前驱动/槽位中检测到可用硬件密钥，请确认已插入智能卡或先填写 PIN。', 'No keys found. Ensure the hardware token is inserted and PIN is provided if required.')}
        </p>
      )}

      {identities && identities.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-md border border-border/60 bg-background/80 divide-y divide-border/40">
          {identities.map((item) => {
            const targetValue = item.keyLabel.trim() || item.keyIdHex
            const isSelected = Boolean(targetValue) && selectedValue.trim() === targetValue
            return (
              <button
                key={`${item.slotId}-${item.keyIdHex}-${item.keyLabel}`}
                type="button"
                onClick={() => onSelect(targetValue)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/60 transition-colors flex items-start gap-2 cursor-pointer',
                  isSelected && 'bg-primary/10 text-primary',
                )}
              >
                <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium truncate">
                      {item.keyLabel.trim() || `CKA_ID:${item.keyIdHex}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {item.algorithm}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                    {item.slotLabel} · {item.fingerprint}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
