import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
  CollectionRecord, FolderRecord, LibraryStore, MembershipRecord, PhotoRecord,
} from '../db/libraryStore'
import { requestStoragePersistence } from '../db/storagePersistence'
import type { AccessPermission, PhotoSource } from '../fs/photoSource'

/** 読み込み中のフォルダと、それまでに見つけた写真の数 */
export type ScanProgress = { folderId: string; found: number }

/** 非同期の操作の途中でも読める、最新の状態 */
export type LatestState = {
  folders: FolderRecord[]
  photos: PhotoRecord[]
  collections: CollectionRecord[]
  memberships: MembershipRecord[]
  /** フォルダを読み込み中か */
  scanning: boolean
}

/** ライブラリの各操作が共有する、状態を読み書きする手段。 */
export type LibraryContext = {
  /** ファイルアクセスの抽象化レイヤー */
  source: PhotoSource
  /** 開いている保存先。開く前や閉じた後は `null` */
  storeRef: RefObject<LibraryStore | null>
  latest: RefObject<LatestState>
  setFolders: Dispatch<SetStateAction<FolderRecord[]>>
  setPhotos: Dispatch<SetStateAction<PhotoRecord[]>>
  setCollections: Dispatch<SetStateAction<CollectionRecord[]>>
  setMemberships: Dispatch<SetStateAction<MembershipRecord[]>>
  setPermissions: Dispatch<SetStateAction<Record<string, AccessPermission>>>
  setScan: Dispatch<SetStateAction<ScanProgress | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setStoragePersisted: Dispatch<SetStateAction<boolean>>
}

/**
 * 開いている保存先に書き込む。書き込めなければ通知する。保存先を開いていなければ何もしない。
 * @param context 状態を読み書きする手段
 * @param write 保存先に書き込む関数
 * @param failure 書き込めなかったときに通知する文
 * @returns 書き込めたら `true`
 */
export const saveToStore = async (
  context: LibraryContext, write: (store: LibraryStore) => Promise<void>, failure: string,
) => {
  const store = context.storeRef.current
  if (!store) return false
  try {
    await write(store)
  } catch {
    context.setNotice(failure)
    return false
  }
  return true
}

/**
 * 写真の配列を ID で更新する。
 * @param current 現在の写真
 * @param updates 追加・置き換えする写真
 * @returns 更新後の写真
 */
export const mergePhotos = (current: PhotoRecord[], updates: PhotoRecord[]) => {
  const byId = new Map(current.map((photo) => [photo.id, photo]))
  for (const photo of updates) byId.set(photo.id, photo)
  return [...byId.values()]
}

/**
 * ブラウザに保存領域を消さないよう頼み、その結果を状態に反映する。
 * @param context 状態を読み書きする手段
 */
export const requestPersistence = (context: LibraryContext) => {
  requestStoragePersistence().then(context.setStoragePersisted)
}
