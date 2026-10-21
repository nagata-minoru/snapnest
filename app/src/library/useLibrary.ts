import { useCallback, useEffect, useRef, useState } from 'react'
import { createMemoryLibraryStore, type FolderRecord, type LibraryStore, type PhotoRecord } from '../db/libraryStore'
import type { AccessPermission, FolderRef, PhotoSource, UnavailableReason } from '../fs/photoSource'
import { ScanError, scanFolder } from './scanFolder'

/** ライブラリの読み込み状態 */
export type LibraryStatus = 'loading' | 'ready'

/** 読み込み中のフォルダと、それまでに見つけた写真の数 */
export type ScanProgress = { folderId: string; found: number }

/** {@link useLibrary} が返す状態と操作。 */
export type Library = {
  status: LibraryStatus
  /** メタデータを IndexedDB に保存できているか */
  persistent: boolean
  folders: FolderRecord[]
  photos: PhotoRecord[]
  permissions: Readonly<Record<string, AccessPermission>>
  scan: ScanProgress | null
  notice: string | null
  addFolder: () => Promise<void>
  rescan: (folderId: string) => Promise<void>
  requestAccess: (folderId: string) => Promise<void>
  reportUnavailable: (photoId: string, reason: UnavailableReason) => void
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
export const useLibrary = (source: PhotoSource, openStore: () => Promise<LibraryStore>): Library => {
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [persistent, setPersistent] = useState(true)
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [photos, setPhotos] = useState<PhotoRecord[]>([])
  const [permissions, setPermissions] = useState<Record<string, AccessPermission>>({})
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const storeRef = useRef<LibraryStore | null>(null)
  const latest = useRef({ folders, photos, scanning: false })
  latest.current = { folders, photos, scanning: scan !== null }

  useEffect(() => {
    let cancelled = false
    let opened: LibraryStore | null = null

    /** 保存先を開いて内容を読み込み、フォルダごとの権限を確かめる。 */
    const start = async () => {
      let store: LibraryStore
      try {
        store = await openStore()
      } catch {
        store = createMemoryLibraryStore()
        if (!cancelled) {
          setPersistent(false)
          setNotice('写真の情報を保存する領域を開けませんでした。このページを閉じると登録内容は失われます。')
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
    if (!source.supported) {
      setNotice('このブラウザはフォルダの参照に対応していません。Chrome で開いてください。')
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

  /** 通知を閉じる。 */
  const dismissNotice =useCallback(() => setNotice(null), [])

  return {
    status, persistent, folders, photos, permissions, scan, notice,
    addFolder, rescan, requestAccess, reportUnavailable, dismissNotice,
  }
}
