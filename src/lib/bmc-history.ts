/**
 * BMC 传感器历史采样存储（localStorage）
 *
 * - 采样来源：BMC 模块传感器轮询（10s 自动刷新）成功后顺带记录
 * - 存储格式：{ [serverId]: { [sensorKey]: Array<[timestamp, value]> } }
 *   （紧凑二元组数组，降低 localStorage 体积）
 * - 每传感器上限 MAX_POINTS 条（10s 采样理论覆盖 24h），超出丢弃最老样本
 * - 总体积超过 MAX_BYTES 时按最老更新的服务器开始清理
 */

const STORAGE_KEY = 'trae:bmc-sensor-history'
/** 每传感器样本上限（10s 采样 = 24h） */
const MAX_POINTS = 864
/** 总体积上限（4MB，预留 localStorage 其余配额） */
const MAX_BYTES = 4 * 1024 * 1024

/** sensorKey = `${category}:${name}`，如 `temp:CPU1 Temp`、`power:total` */
export type BmcHistoryMap = Record<string, Array<[number, number]>>
type StoreShape = Record<string, { updatedAt: number; data: BmcHistoryMap }>

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as StoreShape : {}
  } catch {
    return {}
  }
}

function writeStore(store: StoreShape): void {
  let raw = JSON.stringify(store)
  // 超体积：从最老更新的服务器开始丢弃
  while (raw.length > MAX_BYTES) {
    const ids = Object.keys(store).sort((a, b) => (store[a]?.updatedAt ?? 0) - (store[b]?.updatedAt ?? 0))
    if (ids.length === 0) break
    delete store[ids[0]]
    raw = JSON.stringify(store)
  }
  try {
    localStorage.setItem(STORAGE_KEY, raw)
  } catch {
    // 配额满：清空重来，避免持续报错
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* 忽略 */ }
  }
}

/** 追加一批采样（同一轮询的多个传感器），失败静默（历史记录不阻断主流程） */
export function appendBmcSamples(serverId: string, samples: Array<{ key: string; value: number }>): void {
  if (!serverId || samples.length === 0) return
  const store = readStore()
  const entry = store[serverId] ?? { updatedAt: 0, data: {} }
  const now = Date.now()
  for (const { key, value } of samples) {
    if (!Number.isFinite(value)) continue
    const arr = entry.data[key] ?? []
    arr.push([now, value])
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS)
    entry.data[key] = arr
  }
  entry.updatedAt = now
  store[serverId] = entry
  writeStore(store)
}

/** 读取某服务器的历史（无数据返回空对象） */
export function getBmcHistory(serverId: string): BmcHistoryMap {
  return readStore()[serverId]?.data ?? {}
}

/** 清空某服务器历史（删除服务器时调用可选） */
export function clearBmcHistory(serverId: string): void {
  const store = readStore()
  if (store[serverId]) {
    delete store[serverId]
    writeStore(store)
  }
}
