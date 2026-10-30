import { useEffect, useState } from 'react'
import {
  createMemoryLibraryStore, isNewerVersionError, type LibraryStore, type OpenLibraryStore,
} from '../db/libraryStore'
import type { LibraryContext } from './libraryContext'

/** ライブラリの読み込み状態 */
export type LibraryStatus = 'loading' | 'ready'

/**
 * 保存先との接続の問題。`blocked` は別のタブに残った古い接続が閉じるのを待っている状態、
 * `closed` は別のタブが新しい版で開いたなどの理由で接続が閉じ、保存できなくなった状態
 */
export type StoreIssue = 'blocked' | 'closed'

/**
 * 保存先を開けなかったときに通知する文を作る。
 * @param error 開くときに起きた例外
 * @returns 通知する文
 */
const openFailureMessage = (error: unknown) => {
  if (isNewerVersionError(error)) {
    return (
      '保存済みの写真の情報は新しい版の snapnest で更新されたため、この古い版では読めません。' +
      'ページを再読み込みして新しい版を開いてください。このページを閉じると登録内容は失われます。'
    )
  }
  return '写真の情報を保存する領域を開けませんでした。このページを閉じると登録内容は失われます。'
}

/**
 * 起動時に保存先を開いて保存済みの内容を読み込み、フォルダごとの権限を確かめる。
 * 保存先を開けなければ、メモリ上に保存する。
 * @param context 状態を読み書きする手段
 * @param openStore メタデータの保存先を開く関数
 * @returns 読み込み状態、IndexedDB に保存できているか、保存先との接続の問題
 */
export const useLoadLibrary = (context: LibraryContext, openStore: OpenLibraryStore) => {
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [persistent, setPersistent] = useState(true)
  const [storeIssue, setStoreIssue] = useState<StoreIssue | null>(null)

  useEffect(() => {
    const { source, storeRef, setNotice } = context
    let cancelled = false
    let opened: LibraryStore | null = null

    /**
     * 保存先を開く。開けなければメモリ上の保存先を作り、そのことを通知する。
     * @returns 開いた保存先
     */
    const open = async () => {
      try {
        const store = await openStore({
          /** 待たされていることを画面に出す。 */
          onBlocked: () => {
            if (!cancelled) setStoreIssue('blocked')
          },

          /** 閉じた接続を使わないよう手放し、保存できなくなったことを画面に出す。 */
          onClosed: () => {
            if (cancelled) return
            storeRef.current = null
            setStoreIssue('closed')
          },
        })
        if (!cancelled) setStoreIssue(null)
        return store
      } catch (error) {
        if (!cancelled) {
          setPersistent(false)
          setNotice(openFailureMessage(error))
        }
        return createMemoryLibraryStore()
      }
    }

    /**
     * 保存済みの内容を読み込み、フォルダごとの権限を確かめて画面に反映する。
     * @param store 開いた保存先
     */
    const load = async (store: LibraryStore) => {
      try {
        const snapshot = await store.load()
        const entries = await Promise.all(
          snapshot.folders.map(async (folder) => [folder.id, await source.queryPermission(folder.ref)] as const),
        )
        if (cancelled) return
        context.setFolders(snapshot.folders)
        context.setPhotos(snapshot.photos)
        context.setCollections(snapshot.collections)
        context.setMemberships(snapshot.memberships)
        context.setPermissions(Object.fromEntries(entries))
        if (snapshot.skipped) setNotice(`壊れた保存データが ${snapshot.skipped} 件あったため、読み飛ばしました。`)
      } catch {
        if (!cancelled) setNotice('保存済みの写真の情報を読み込めませんでした。')
      }
    }

    /** 保存先を開いて内容を読み込む。 */
    const start = async () => {
      const store = await open()
      opened = store
      if (cancelled) {
        store.close()
        return
      }
      storeRef.current = store
      await load(store)
      if (!cancelled) setStatus('ready')
    }

    start()
    return () => {
      cancelled = true
      opened?.close()
      storeRef.current = null
    }
  }, [context, openStore])

  return { status, persistent, storeIssue }
}
