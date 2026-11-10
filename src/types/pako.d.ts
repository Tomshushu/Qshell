declare module 'pako' {
  export const Z_SYNC_FLUSH: number
  export const Z_NO_FLUSH: number
  export const Z_FINISH: number

  export class Inflate {
    constructor(options?: { raw?: boolean; chunkSize?: number; to?: string })
    onData: (chunk: Uint8Array) => void
    push(chunk: Uint8Array, flushMode?: number | boolean): boolean
    reset(): void
    err: number
    msg?: string
    result?: Uint8Array | string
  }

  export class Deflate {
    constructor(options?: { raw?: boolean; level?: number })
    push(chunk: Uint8Array, flushMode?: number | boolean): boolean
    result: Uint8Array
  }
}
