import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PhotoRecord, ThumbnailCache, ThumbnailRecord } from '../db/libraryStore'
import type { PhotoSource, ReadResult, UnavailableReason } from '../fs/photoSource'
import type { ThumbnailMaker } from '../thumbnails/thumbnailMaker'

/** 写真の画像の読み込み状態 */
export type PhotoImage =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed'; reason: UnavailableReason }

/**
 * 写真の原本を読み込み、表示用のオブジェクト URL を作る。
 * 原本はコピーせず、使い終わった URL はすぐ解放する。
 * @param source ファイルアクセスの抽象化レイヤー
 * @param photo 表示する写真
 * @param enabled 読み込むかどうか。`false` なら読み込まず、作った URL も解放する
 * @param onUnavailable 読めなかったときに呼ばれる
 * @returns 読み込み状態
 */
export const usePhotoUrl = (
  source: PhotoSource,
  photo: PhotoRecord,
  enabled: boolean,
  onUnavailable: (photoId: string, reason: UnavailableReason) => void,
): PhotoImage => {
  const [image, setImage] = useState<PhotoImage>({ status: 'idle' })
  const report = useRef(onUnavailable)
  report.current = onUnavailable
  const { id, ref } = photo

  useEffect(() => {
    if (!enabled) {
      setImage({ status: 'idle' })
      return
    }
    let cancelled = false
    let url: string | null = null
    setImage({ status: 'loading' })
    source.readFile(ref)
      .catch((): ReadResult => ({ ok: false, reason: 'unavailable' }))
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          url = URL.createObjectURL(result.file)
          setImage({ status: 'ready', url })
        } else {
          setImage({ status: 'failed', reason: result.reason })
          report.current(id, result.reason)
        }
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, id, ref, enabled])

  return image
}

/**
 * キャッシュ済みのサムネイルが原本と同じ版から作られたものか判定する。
 * @param thumbnail キャッシュ済みのサムネイル
 * @param original 原本のサイズと更新日時
 * @returns 同じ版から作られていれば `true`
 */
const isFresh = (thumbnail: ThumbnailRecord | null, original: { size: number; lastModified: number }) => (
  thumbnail !== null && thumbnail.size === original.size && thumbnail.lastModified === original.lastModified
)

/**
 * 一覧に表示するサムネイルの URL を用意する。
 * 原本を読めるときは原本のサイズと更新日時でキャッシュを確かめ、古ければ作り直して保存する。
 * サムネイルを作れなければ原本をそのまま表示する。
 * 原本を読めないとき（参照切れ・権限なし）は、写真の情報と一致するキャッシュがあればそれを表示する。
 * @param options.source ファイルアクセスの抽象化レイヤー
 * @param options.cache サムネイルのキャッシュ
 * @param options.makeThumbnail 原本からサムネイルを作る関数
 * @param options.photo 表示する写真
 * @param options.enabled 読み込むかどうか。`false` なら読み込まず、作った URL も解放する
 * @param options.readable 原本を読みに行ってよいか。`false` ならキャッシュだけを使う
 * @param options.onUnavailable 原本を読めなかったときに呼ばれる
 * @returns 読み込み状態
 */
export const useThumbnailUrl = ({ source, cache, makeThumbnail, photo, enabled, readable, onUnavailable }: {
  source: PhotoSource
  cache: ThumbnailCache
  makeThumbnail: ThumbnailMaker
  photo: PhotoRecord
  enabled: boolean
  readable: boolean
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
}): PhotoImage => {
  const [image, setImage] = useState<PhotoImage>({ status: 'idle' })
  const report = useRef(onUnavailable)
  report.current = onUnavailable
  const { id, ref, size, lastModified } = photo

  useEffect(() => {
    if (!enabled) {
      setImage({ status: 'idle' })
      return
    }
    let cancelled = false
    let url: string | null = null
    const abort = new AbortController()

    /**
     * 画像を表示する URL を作る。
     * @param blob 表示する画像
     */
    const show = (blob: Blob) => {
      url = URL.createObjectURL(blob)
      setImage({ status: 'ready', url })
    }

    /**
     * キャッシュを読む。読めなければキャッシュがないものとして扱う。
     * @returns サムネイル。なければ `null`
     */
    const readCache = () => cache.getThumbnail(id).catch(() => null)

    /** キャッシュか原本からサムネイルを用意する。 */
    const load = async () => {
      if (!readable) {
        const cached = await readCache()
        if (cancelled) return
        if (cached && isFresh(cached, { size, lastModified })) {
          show(new Blob([cached.bytes], { type: cached.type }))
        } else {
          setImage({ status: 'idle' })
        }
        return
      }

      const [result, cached] = await Promise.all([
        source.readFile(ref).catch((): ReadResult => ({ ok: false, reason: 'unavailable' })),
        readCache(),
      ])
      if (cancelled) return
      if (!result.ok) {
        setImage({ status: 'failed', reason: result.reason })
        report.current(id, result.reason)
        return
      }
      const { file } = result
      if (cached && isFresh(cached, file)) {
        show(new Blob([cached.bytes], { type: cached.type }))
        return
      }
      const thumbnail = await makeThumbnail(file, abort.signal).catch(() => null)
      if (cancelled) return
      if (!thumbnail) {
        show(file)
        return
      }
      show(thumbnail)
      const bytes = await thumbnail.arrayBuffer()
      const record = { photoId: id, size: file.size, lastModified: file.lastModified, type: thumbnail.type, bytes }
      // 保存できなくても（容量不足など）表示は続ける
      await cache.putThumbnail({ ...record, createdAt: Date.now() }).catch(() => {})
    }

    setImage({ status: 'loading' })
    load().catch(() => {
      if (!cancelled) setImage({ status: 'failed', reason: 'unavailable' })
    })
    return () => {
      cancelled = true
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, cache, makeThumbnail, id, ref, size, lastModified, enabled, readable])

  return image
}

/**
 * 要素が画面の近くにあるか監視する。IntersectionObserver がなければ常に `true` を返す。
 * @param target 監視する要素
 * @param rootMargin 画面からどれだけ離れていても「近く」とみなすか
 * @returns 画面の近くにあれば `true`
 */
export const useNearViewport = (target: RefObject<Element | null>, rootMargin = '400px') => {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = target.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin })
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, rootMargin])

  return near
}
