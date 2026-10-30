import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  CollectionRecord, FolderRecord, LibraryStore, MembershipRecord, OpenLibraryStore, PhotoRecord, ThumbnailCache,
} from '../db/libraryStore'
import type { AccessPermission, PhotoSource, UnavailableReason } from '../fs/photoSource'
import type { LibraryContext, ScanProgress } from './libraryContext'
import { useCollectionActions } from './useCollectionActions'
import { useFolderActions } from './useFolderActions'
import { useLoadLibrary, type LibraryStatus, type StoreIssue } from './useLoadLibrary'
import { usePhotoActions } from './usePhotoActions'

export type { ScanProgress } from './libraryContext'
export type { LibraryStatus, StoreIssue } from './useLoadLibrary'

/** {@link useLibrary} が返す状態と操作。 */
export type Library = {
  status: LibraryStatus
  /** メタデータを IndexedDB に保存できているか */
  persistent: boolean
  /** 保存先との接続の問題。なければ `null` */
  storeIssue: StoreIssue | null
  /** ブラウザが、容量不足のときにも保存領域を消さずに保つと約束しているか */
  storagePersisted: boolean
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
 * 写真ライブラリの状態と操作をまとめて扱う。
 * 起動時に保存済みのメタデータを読み込み、各フォルダの権限を確かめる。
 * @param source ファイルアクセスの抽象化レイヤー
 * @param openStore メタデータの保存先を開く関数
 * @returns ライブラリの状態と操作
 */
export const useLibrary = (source: PhotoSource, openStore: OpenLibraryStore): Library => {
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [photos, setPhotos] = useState<PhotoRecord[]>([])
  const [collections, setCollections] = useState<CollectionRecord[]>([])
  const [memberships, setMemberships] = useState<MembershipRecord[]>([])
  const [permissions, setPermissions] = useState<Record<string, AccessPermission>>({})
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [storagePersisted, setStoragePersisted] = useState(false)
  const storeRef = useRef<LibraryStore | null>(null)
  const latest = useRef({ folders, photos, collections, memberships, scanning: false })
  latest.current = { folders, photos, collections, memberships, scanning: scan !== null }

  // 状態を更新する関数と ref は描画をまたいで変わらないため、source が変わったときだけ作り直す
  const context = useMemo<LibraryContext>(() => ({
    source, storeRef, latest,
    setFolders, setPhotos, setCollections, setMemberships, setPermissions, setScan, setNotice, setStoragePersisted,
  }), [source])

  const { status, persistent, storeIssue } = useLoadLibrary(context, openStore)
  // 部品ごとの操作は分割代入で受け取る。名前が重なれば、同じ名前の const になり型チェックで気づける
  const { addFolder, rescan, requestAccess } = useFolderActions(context)
  const {
    createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection,
  } = useCollectionActions(context)
  const { reportUnavailable, reconnectPhoto, removePhoto } = usePhotoActions(context)

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
    status, persistent, storeIssue, storagePersisted, folders, photos, collections, memberships, permissions, scan,
    notice, thumbnails,
    addFolder, rescan, requestAccess, reportUnavailable,
    createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection,
    reconnectPhoto, removePhoto, dismissNotice,
  }
}
