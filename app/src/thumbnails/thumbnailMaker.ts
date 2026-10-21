/**
 * 原本からサムネイルを作る関数。
 * 作れないとき（非対応のブラウザ、壊れた画像、縮小するまでもない小さな画像など）は `null` を返す。
 * @param file 原本
 * @param signal 中止の合図。中止されたら、まだ作っていなければ `null` を返す
 * @returns サムネイルの画像
 */
export type ThumbnailMaker = (file: File, signal?: AbortSignal) => Promise<Blob | null>

/** Worker へ送る依頼 */
export type ThumbnailRequest = { id: number; file: File }

/** Worker から返る結果。`blob` が `null` なら作らなかった */
export type ThumbnailResponse = { id: number; blob: Blob | null }

/** サムネイルの短辺の長さ（px）。一覧のカードを高解像度の画面でもぼやけずに覆える大きさにする */
export const THUMBNAIL_SHORT_SIDE = 400

/** 細長い画像でもサムネイルが大きくなりすぎないよう、長辺をこの長さ（px）までに抑える */
export const THUMBNAIL_LONG_SIDE_LIMIT = 1200

/**
 * 原本の大きさから、サムネイルの大きさを決める。
 * @param width 原本の幅
 * @param height 原本の高さ
 * @returns サムネイルの幅と高さ。縮小する必要がなければ `null`
 */
export const thumbnailSize = (width: number, height: number) => {
  if (!(width > 0 && height > 0)) return null
  const scale = Math.min(
    THUMBNAIL_SHORT_SIDE / Math.min(width, height),
    THUMBNAIL_LONG_SIDE_LIMIT / Math.max(width, height),
  )
  if (scale >= 1) return null
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * サムネイルを作らない ThumbnailMaker。非対応のブラウザやテストで使う。
 * @returns 常に `null`
 */
export const noThumbnail: ThumbnailMaker = async () => null

/**
 * 同時に作るサムネイルの数を制限する。待っている間に中止された依頼は、作らずに `null` を返す。
 * 原本の展開はメモリを多く使うため、一覧を素早くスクロールしても一度に展開しすぎないようにする。
 * @param make サムネイルを作る関数
 * @param concurrency 同時に作る数
 * @returns 数を制限した ThumbnailMaker
 */
export const createThumbnailQueue = (make: ThumbnailMaker, concurrency = 2): ThumbnailMaker => {
  const waiting: Array<() => void> = []
  let running = 0

  /** 空きがあれば、待っている依頼を始める。 */
  const pump = () => {
    while (running < concurrency && waiting.length) waiting.shift()?.()
  }

  return (file, signal) => new Promise<Blob | null>((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }

    /** 依頼を始め、終わったら次の依頼に空きを渡す。 */
    const start = () => {
      signal?.removeEventListener('abort', cancel)
      running += 1
      make(file, signal)
        .catch(() => null)
        .then((blob) => {
          running -= 1
          resolve(blob)
          pump()
        })
    }

    /** 待っている依頼を取り下げる。 */
    const cancel = () => {
      const index = waiting.indexOf(start)
      if (index >= 0) waiting.splice(index, 1)
      resolve(null)
    }

    signal?.addEventListener('abort', cancel, { once: true })
    waiting.push(start)
    pump()
  })
}

/**
 * Worker の中でサムネイルを作る ThumbnailMaker を作る。画像の展開と縮小はメインスレッドの外で行う。
 * Worker は最初の依頼のときに作る。Worker や OffscreenCanvas を使えないブラウザでは常に `null` を返す。
 * @returns Worker を使う ThumbnailMaker
 */
export const createWorkerThumbnailMaker = (): ThumbnailMaker => {
  const pending = new Map<number, (blob: Blob | null) => void>()
  let worker: Worker | null | undefined
  let nextId = 0

  /**
   * Worker を用意する。使えなければ `null` を返す。
   * @returns Worker
   */
  const ensureWorker = () => {
    if (worker !== undefined) return worker
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      worker = null
      return worker
    }
    try {
      worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
      return worker
    }
    worker.onmessage = (event: MessageEvent<ThumbnailResponse>) => {
      pending.get(event.data.id)?.(event.data.blob)
      pending.delete(event.data.id)
    }
    // Worker を読み込めないなど、続けられない失敗なら以後は作らない
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      for (const resolve of pending.values()) resolve(null)
      pending.clear()
    }
    return worker
  }

  return async (file, signal) => {
    const current = ensureWorker()
    if (!current || signal?.aborted) return null
    const id = ++nextId
    return new Promise<Blob | null>((resolve) => {
      pending.set(id, resolve)
      current.postMessage({ id, file } satisfies ThumbnailRequest)
    })
  }
}
