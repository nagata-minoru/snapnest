import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PhotoRecord } from '../db/libraryStore'
import type { PhotoSource, ReadResult, UnavailableReason } from '../fs/photoSource'

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
