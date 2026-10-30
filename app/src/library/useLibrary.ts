import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createMemoryLibraryStore, isNewerVersionError, type CollectionRecord, type FolderRecord, type LibraryStore,
  type MembershipRecord, type OpenLibraryStore, type PhotoRecord, type ThumbnailCache,
} from '../db/libraryStore'
import {
  unsupportedMessage, type AccessPermission, type FolderRef, type PhotoSource, type UnavailableReason,
} from '../fs/photoSource'
import { validateCollectionName } from './collections'
import { formatLocation } from './format'
import { ScanError, scanFolder } from './scanFolder'

/** ライブラリの読み込み状態 */
export type LibraryStatus = 'loading' | 'ready'

/**
 * 保存先との接続の問題。`blocked` は別のタブに残った古い接続が閉じるのを待っている状態、
 * `closed` は別のタブが新しい版で開いたなどの理由で接続が閉じ、保存できなくなった状態
 */
export type StoreIssue = 'blocked' | 'closed'

/** 読み込み中のフォルダと、それまでに見つけた写真の数 */
export type ScanProgress = { folderId: string; found: number }

/** {@link useLibrary} が返す状態と操作。 */
export type Library = {
  status: LibraryStatus
  /** メタデータを IndexedDB に保存できているか */
  persistent: boolean
  /** 保存先との接続の問題。なければ `null` */
  storeIssue: StoreIssue | null
  folders: FolderRecord[]
  photos: PhotoRecord[]
  collections: CollectionRecord[]
  memberships: MembershipRecord[]
  permissions: Readonly<Record<string, AccessPermission>>
  scan: ScanProgress | null
  notice: string | null
  /** サムネイルのキャッシュ。保存先を開く前や閉じた後は、何もないものとして振る舞う */
  thumbnails: ThumbnailCache
  addFolder: () => Promise<void>
  rescan: (folderId: string) => Promise<void>
  requestAccess: (folderId: string) => Promise<void>
  reportUnavailable: (photoId: string, reason: UnavailableReason) => void
  /** コレクションを作る。名前が使えないか保存できなければ通知して `null` を返す */
  createCollection: (name: string) => Promise<CollectionRecord | null>
  /** コレクションの名前を変える。名前が使えないか保存できなければ通知して `false` を返す */
  renameCollection: (collectionId: string, name: string) => Promise<boolean>
  /** コレクションを削除する。写真は削除しない。保存できなければ通知して `false` を返す */
  deleteCollection: (collectionId: string) => Promise<boolean>
  addToCollection: (collectionId: string, photoId: string) => Promise<void>
  removeFromCollection: (collectionId: string, photoId: string) => Promise<void>
  /** 見つからない写真を別の写真につなぎ直す。保存できなければ通知して `false` を返す */
  reconnectPhoto: (missingId: string, targetId: string) => Promise<boolean>
  /** 写真の記録をライブラリから外す。原本には触れない。保存できなければ通知して `false` を返す */
  removePhoto: (photoId: string) => Promise<boolean>
  dismissNotice: () => void
}

/**
 * 写真の配列を ID で更新する。
 * @param current 現在の写真
 * @param updates 追加・置き換えする写真
 * @returns 更新後の写真
 */
const mergePhotos = (current: PhotoRecord[], updates: PhotoRecord[]) => {
  const byId = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of updates) byId.set(photo.id, photo)
  return [...byId.values()]
}

/**
 * フォルダの読み込み結果を利用者向けの文に直す。
 * @param found 見つかった写真の数
 * @param missing 見つからなくなった写真の数
 * @returns 通知する文
 */
const scanMessage = (found: number, missing: number) => (
  `${found} 枚の写真を読み込みました。` + (missing ? `${missing} 枚が見つからなくなりました。` : '')
)

/**
 * ブラウザに保存領域を消さないよう求める。失敗しても何もしない。
 */
const requestPersistence = () => {
  navigator.storage?.persist?.().catch(() => {})
}

/**
 * 写真ライブラリの状態と操作をまとめて扱う。
 * 起動時に保存済みのメタデータを読み込み、各フォルダの権限を確かめる。
 * @param source ファイルアクセスの抽象化レイヤー
 * @param openStore メタデータの保存先を開く関数
 * @returns ライブラリの状態と操作
 */
export const useLibrary = (source: PhotoSource, openStore: OpenLibraryStore): Library => {
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [persistent, setPersistent] = useState(true)
  const [storeIssue, setStoreIssue] = useState<StoreIssue | null>(null)
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [photos, setPhotos] = useState<PhotoRecord[]>([])
  const [collections, setCollections] = useState<CollectionRecord[]>([])
  const [memberships, setMemberships] = useState<MembershipRecord[]>([])
  const [permissions, setPermissions] = useState<Record<string, AccessPermission>>({})
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const storeRef = useRef<LibraryStore | null>(null)
  const latest = useRef({ folders, photos, collections, memberships, scanning: false })
  latest.current = { folders, photos, collections, memberships, scanning: scan !== null }

  useEffect(() => {
    let cancelled = false
    let opened: LibraryStore | null = null

    /** 保存先を開いて内容を読み込み、フォルダごとの権限を確かめる。 */
    const start = async () => {
      let store: LibraryStore
      try {
        store = await openStore({
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
      } catch (error) {
        store = createMemoryLibraryStore()
        if (!cancelled) {
          setPersistent(false)
          if (isNewerVersionError(error)) {
            setNotice(
              '保存済みの写真の情報は新しい版の snapnest で更新されたため、この古い版では読めません。' +
              'ページを再読み込みして新しい版を開いてください。このページを閉じると登録内容は失われます。',
            )
          } else {
            setNotice('写真の情報を保存する領域を開けませんでした。このページを閉じると登録内容は失われます。')
          }
        }
      }
      opened = store
      if (cancelled) {
        store.close()
        return
      }
      storeRef.current = store

      try {
        const snapshot = await store.load()
        const entries = await Promise.all(
          snapshot.folders.map(async (folder) => [folder.id, await source.queryPermission(folder.ref)] as const),
        )
        if (cancelled) return
        setFolders(snapshot.folders)
        setPhotos(snapshot.photos)
        setCollections(snapshot.collections)
        setMemberships(snapshot.memberships)
        setPermissions(Object.fromEntries(entries))
        if (snapshot.skipped) setNotice(`壊れた保存データが ${snapshot.skipped} 件あったため、読み飛ばしました。`)
      } catch {
        if (!cancelled) setNotice('保存済みの写真の情報を読み込めませんでした。')
      }
      if (!cancelled) setStatus('ready')
    }

    start()
    return () => {
      cancelled = true
      opened?.close()
      storeRef.current = null
    }
  }, [source, openStore])

  /**
   * フォルダを読み込み、結果を画面と通知に反映する。
   * @param folder 読み込むフォルダ
   */
  const runScan = useCallback(async (folder: FolderRecord) => {
    const store = storeRef.current
    if (!store) return
    setScan({ folderId: folder.id, found: 0 })
    try {
      const outcome = await scanFolder({
        source,
        store,
        folder,
        existing: latest.current.photos.filter((photo) => photo.folderId === folder.id),
        onBatch: (batch, found) => {
          setPhotos((current) => mergePhotos(current, batch))
          setScan({ folderId: folder.id, found })
        },
      })
      setPhotos((current) => mergePhotos(current, outcome.missing))
      setFolders((current) => current.map((item) => item.id === folder.id ? { ...item, scannedAt: Date.now() } : item))
      setNotice(scanMessage(outcome.found, outcome.missing.length))
    } catch (error) {
      const found = error instanceof ScanError ? error.found : 0
      setNotice(
        `「${folder.name}」の読み込みが途中で止まりました（${found} 枚まで）。` +
        'フォルダへのアクセスを確認して、再読み込みしてください。',
      )
    } finally {
      setScan(null)
    }
  }, [source])

  /**
   * 保存済みのフォルダから、指定した参照と同じものを探す。
   * @param ref 探すフォルダの参照
   * @returns 見つかったフォルダ。なければ `undefined`
   */
  const findSameFolder = useCallback(async (ref: FolderRef) => {
    for (const folder of latest.current.folders) {
      if (await source.isSameFolder(folder.ref, ref)) return folder
    }
    return undefined
  }, [source])

  /**
   * 利用者に選んでもらったフォルダを登録し、読み込む。登録済みのフォルダなら情報を更新する。
   */
  const addFolder = useCallback(async () => {
    if (latest.current.scanning || !storeRef.current) return
    if (source.support !== 'supported') {
      setNotice(unsupportedMessage(source.support))
      return
    }
    const result = await source.pickFolder()
    if (result.status === 'cancelled') return
    if (result.status === 'failed') {
      setNotice(result.message)
      return
    }
    const store = storeRef.current
    if (!store) return

    const same = await findSameFolder(result.ref)
    let folder: FolderRecord
    if (same) {
      folder = { ...same, name: result.name, ref: result.ref }
    } else {
      folder = { id: crypto.randomUUID(), name: result.name, ref: result.ref, addedAt: Date.now(), scannedAt: null }
    }
    try {
      await store.putFolder(folder)
    } catch {
      setNotice('フォルダの情報を保存できませんでした。')
      return
    }
    setFolders((current) => same ? current.map((item) => item.id === folder.id ? folder : item) : [...current, folder])
    setPermissions((current) => ({ ...current, [folder.id]: 'granted' }))
    requestPersistence()
    await runScan(folder)
  }, [findSameFolder, runScan, source])

  /**
   * フォルダの読み取り権限を求める。
   * @param folder 権限を求めるフォルダ
   * @returns 求めた後の権限の状態
   */
  const ensurePermission = useCallback(async (folder: FolderRecord) => {
    const current = await source.queryPermission(folder.ref)
    const permission = current === 'granted' ? current : await source.requestPermission(folder.ref)
    setPermissions((items) => ({ ...items, [folder.id]: permission }))
    if (permission !== 'granted') {
      setNotice(`「${folder.name}」へのアクセスが許可されませんでした。写真を表示するには許可が必要です。`)
    }
    return permission
  }, [source])

  /**
   * フォルダへのアクセス許可を求める。
   * @param folderId 許可を求めるフォルダの ID
   */
  const requestAccess = useCallback(async (folderId: string) => {
    const folder = latest.current.folders.find((item) => item.id === folderId)
    if (folder) await ensurePermission(folder)
  }, [ensurePermission])

  /**
   * 権限を確かめてから、フォルダを読み込み直す。
   * @param folderId 読み込み直すフォルダの ID
   */
  const rescan = useCallback(async (folderId: string) => {
    const folder = latest.current.folders.find((item) => item.id === folderId)
    if (!folder || latest.current.scanning) return
    if (await ensurePermission(folder) === 'granted') await runScan(folder)
  }, [ensurePermission, runScan])

  /**
   * 原本を読めなかったことを受け取る。見つからなければ `missing` にし、権限がなければ権限を調べ直す。
   * @param photoId 読めなかった写真の ID
   * @param reason 読めなかった理由
   */
  const reportUnavailable = useCallback<Library['reportUnavailable']>((photoId, reason) => {
    const photo = latest.current.photos.find((item) => item.id === photoId)
    if (!photo) return
    if (reason === 'not-found' && photo.status !== 'missing') {
      const updated: PhotoRecord = { ...photo, status: 'missing', updatedAt: Date.now() }
      setPhotos((current) => mergePhotos(current, [updated]))
      storeRef.current?.putPhotos([updated]).catch(() => {})
    }
    if (reason === 'permission') {
      const folder = latest.current.folders.find((item) => item.id === photo.folderId)
      if (!folder) return
      source.queryPermission(folder.ref).then((permission) => {
        setPermissions((current) => ({ ...current, [folder.id]: permission }))
      })
    }
  }, [source])

  /**
   * コレクションを作る。
   * @param input 入力された名前
   * @returns 作ったコレクション。作れなければ `null`
   */
  const createCollection = useCallback(async (input: string) => {
    const store = storeRef.current
    if (!store) return null
    const result = validateCollectionName(input, latest.current.collections)
    if ('error' in result) {
      setNotice(result.error)
      return null
    }
    const now = Date.now()
    const collection: CollectionRecord = { id: crypto.randomUUID(), name: result.name, createdAt: now, updatedAt: now }
    try {
      await store.putCollection(collection)
    } catch {
      setNotice('コレクションを保存できませんでした。')
      return null
    }
    setCollections((current) => [...current, collection])
    requestPersistence()
    return collection
  }, [])

  /**
   * コレクションの名前を変える。
   * @param collectionId コレクションの ID
   * @param input 入力された名前
   * @returns 変えられたら `true`
   */
  const renameCollection = useCallback(async (collectionId: string, input: string) => {
    const store = storeRef.current
    const collection = latest.current.collections.find((item) => item.id === collectionId)
    if (!store || !collection) return false
    const result = validateCollectionName(input, latest.current.collections, collectionId)
    if ('error' in result) {
      setNotice(result.error)
      return false
    }
    const renamed: CollectionRecord = { ...collection, name: result.name, updatedAt: Date.now() }
    try {
      await store.putCollection(renamed)
    } catch {
      setNotice('コレクションの名前を保存できませんでした。')
      return false
    }
    setCollections((current) => current.map((item) => item.id === collectionId ? renamed : item))
    return true
  }, [])

  /**
   * コレクションと、そこへの所属を削除する。写真そのものは残す。
   * @param collectionId 削除するコレクションの ID
   * @returns 削除できたら `true`
   */
  const deleteCollection = useCallback(async (collectionId: string) => {
    const store = storeRef.current
    const collection = latest.current.collections.find((item) => item.id === collectionId)
    if (!store || !collection) return false
    try {
      await store.deleteCollection(collectionId)
    } catch {
      setNotice('コレクションを削除できませんでした。')
      return false
    }
    setCollections((current) => current.filter((item) => item.id !== collectionId))
    setMemberships((current) => current.filter((item) => item.collectionId !== collectionId))
    setNotice(`コレクション「${collection.name}」を削除しました。写真はライブラリに残っています。`)
    return true
  }, [])

  /**
   * 写真をコレクションに入れる。入っていれば何もしない。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   */
  const addToCollection = useCallback(async (collectionId: string, photoId: string) => {
    const store = storeRef.current
    if (!store) return
    const exists = latest.current.memberships.some((item) => (
      item.collectionId === collectionId && item.photoId === photoId
    ))
    if (exists) return
    const membership: MembershipRecord = { collectionId, photoId, addedAt: Date.now() }
    try {
      await store.putMembership(membership)
    } catch {
      setNotice('コレクションに追加できませんでした。')
      return
    }
    setMemberships((current) => [...current, membership])
  }, [])

  /**
   * 写真をコレクションから外す。写真そのものは残す。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   */
  const removeFromCollection = useCallback(async (collectionId: string, photoId: string) => {
    const store = storeRef.current
    if (!store) return
    try {
      await store.deleteMembership(collectionId, photoId)
    } catch {
      setNotice('コレクションから外せませんでした。')
      return
    }
    setMemberships((current) => current.filter((item) => (
      !(item.collectionId === collectionId && item.photoId === photoId)
    )))
  }, [])

  /**
   * 見つからない写真を、利用者が選んだ写真につなぎ直す。
   * コレクションへの所属を引き継ぎ、登録日時は古い方を残し、見つからない写真の記録を外す。
   * @param missingId 見つからない写真の ID
   * @param targetId つなぎ直す先の写真の ID
   * @returns つなぎ直せたら `true`
   */
  const reconnectPhoto = useCallback(async (missingId: string, targetId: string) => {
    const store = storeRef.current
    const missing = latest.current.photos.find((photo) => photo.id === missingId)
    const target = latest.current.photos.find((photo) => photo.id === targetId)
    if (!store || !missing || !target || missing.status !== 'missing' || target.status !== 'available') return false
    const addedAt = Math.min(target.addedAt, missing.addedAt)
    const updated: PhotoRecord = { ...target, addedAt, updatedAt: Date.now() }
    try {
      await store.reconnectPhoto(missingId, updated)
    } catch {
      setNotice('つなぎ直せませんでした。')
      return false
    }
    setPhotos((current) => mergePhotos(current.filter((photo) => photo.id !== missingId), [updated]))
    setMemberships((current) => {
      const joined = new Set(current.filter((item) => item.photoId === targetId).map((item) => item.collectionId))
      return current.flatMap((item) => {
        if (item.photoId !== missingId) return [item]
        return joined.has(item.collectionId) ? [] : [{ ...item, photoId: targetId }]
      })
    })
    const { folders } = latest.current
    /**
     * 写真の保存場所を表す文を作る。
     * @param photo 写真
     * @returns 「Pictures / trip / station.png」のような文
     */
    const locationOf = (photo: PhotoRecord) => (
      formatLocation(folders.find((folder) => folder.id === photo.folderId)?.name, photo.relativePath)
    )
    setNotice(`「${locationOf(missing)}」を「${locationOf(target)}」につなぎ直しました。`)
    return true
  }, [])

  /**
   * 写真の記録を、コレクションへの所属・サムネイルとまとめてライブラリから外す。
   * @param photoId 外す写真の ID
   * @returns 外せたら `true`
   */
  const removePhoto = useCallback(async (photoId: string) => {
    const store = storeRef.current
    const photo = latest.current.photos.find((item) => item.id === photoId)
    if (!store || !photo) return false
    try {
      await store.deletePhoto(photoId)
    } catch {
      setNotice('ライブラリから外せませんでした。')
      return false
    }
    setPhotos((current) => current.filter((item) => item.id !== photoId))
    setMemberships((current) => current.filter((item) => item.photoId !== photoId))
    setNotice(`「${photo.name}」をライブラリから外しました。写真の原本には触れていません。`)
    return true
  }, [])

  /** 通知を閉じる。 */
  const dismissNotice = useCallback(() => setNotice(null), [])

  const thumbnails = useMemo<ThumbnailCache>(() => ({
    /**
     * 開いている保存先からサムネイルを読む。
     * @param photoId 写真の ID
     * @returns サムネイル。保存先を開いていなければ `null`
     */
    getThumbnail: async (photoId) => (await storeRef.current?.getThumbnail(photoId)) ?? null,

    /**
     * 開いている保存先にサムネイルを保存する。保存先を開いていなければ何もしない。
     * @param thumbnail 保存するサムネイル
     */
    putThumbnail: async (thumbnail) => {
      await storeRef.current?.putThumbnail(thumbnail)
    },
  }), [])

  return {
    status, persistent, storeIssue, folders, photos, collections, memberships, permissions, scan, notice, thumbnails,
    addFolder, rescan, requestAccess, reportUnavailable,
    createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection,
    reconnectPhoto, removePhoto, dismissNotice,
  }
}
