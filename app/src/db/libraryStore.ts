import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FileRef, FolderRef } from '../fs/photoSource'

export const DB_NAME = 'snapnest'
export const DB_VERSION = 2

/** 登録済みフォルダ。写真の原本ではなく、フォルダへの参照だけを持つ。 */
export type FolderRecord = {
  id: string
  name: string
  ref: FolderRef
  addedAt: number
  /** 最後に読み込みを終えた日時。まだなら `null` */
  scannedAt: number | null
}

/** 写真の参照状態。`missing` は最後の読み込みや表示でファイルが見つからなかったもの */
export type PhotoStatus = 'available' | 'missing'

/** 写真のメタデータ。原本の内容は保存しない。 */
export type PhotoRecord = {
  /** `フォルダID:相対パス` */
  id: string
  folderId: string
  relativePath: string
  name: string
  size: number
  lastModified: number
  type: string
  ref: FileRef
  status: PhotoStatus
  addedAt: number
  updatedAt: number
}

/**
 * 写真のサムネイル。原本を縮小して作り直した画像で、原本そのものは保存しない。
 * 原本のサイズか更新日時が変わったら作り直す。
 */
export type ThumbnailRecord = {
  photoId: string
  /** 作ったときの原本のサイズ */
  size: number
  /** 作ったときの原本の更新日時 */
  lastModified: number
  /** 画像の MIME タイプ */
  type: string
  /** 画像の内容。Blob はブラウザによって保存できないことがあるため ArrayBuffer で持つ */
  bytes: ArrayBuffer
  createdAt: number
}

interface LibrarySchema extends DBSchema {
  folders: { key: string; value: FolderRecord }
  photos: { key: string; value: PhotoRecord; indexes: { byFolder: string } }
  thumbnails: { key: string; value: ThumbnailRecord }
}

/** IndexedDB から読み込んだライブラリの内容。 */
export type LibrarySnapshot = {
  folders: FolderRecord[]
  photos: PhotoRecord[]
  /** 壊れていて読み飛ばしたレコードの数 */
  skipped: number
}

/** ライブラリのメタデータを保存する場所。 */
export interface LibraryStore {
  /**
   * 保存済みのフォルダと写真をすべて読み込む。壊れたレコードは読み飛ばす。
   * @returns 読み込んだ内容
   */
  load(): Promise<LibrarySnapshot>

  /**
   * フォルダを保存する。同じ ID があれば置き換える。
   * @param folder 保存するフォルダ
   */
  putFolder(folder: FolderRecord): Promise<void>

  /**
   * 写真をまとめて保存する。同じ ID があれば置き換える。
   * @param photos 保存する写真
   */
  putPhotos(photos: PhotoRecord[]): Promise<void>

  /**
   * 写真のサムネイルを読む。壊れたレコードはないものとして扱う。
   * @param photoId 写真の ID
   * @returns サムネイル。なければ `null`
   */
  getThumbnail(photoId: string): Promise<ThumbnailRecord | null>

  /**
   * 写真のサムネイルを保存する。同じ写真のものがあれば置き換える。
   * @param thumbnail 保存するサムネイル
   */
  putThumbnail(thumbnail: ThumbnailRecord): Promise<void>

  /** データベースとの接続を閉じる。 */
  close(): void
}

/** サムネイルのキャッシュ。{@link LibraryStore} のうちサムネイルを扱う部分 */
export type ThumbnailCache = Pick<LibraryStore, 'getThumbnail' | 'putThumbnail'>

/**
 * 値が文字列をキーに持つオブジェクトか判定する。
 * @param value 判定する値
 * @returns オブジェクトなら `true`
 */
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * 値が有限の数か判定する。
 * @param value 判定する値
 * @returns 有限の数なら `true`
 */
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * IndexedDB から読んだ値をフォルダとして検証する。
 * @param value 読んだ値
 * @returns フォルダ。形が合わなければ `null`
 */
export const parseFolderRecord = (value: unknown): FolderRecord | null => {
  if (!isObject(value)) return null
  const { id, name, ref, addedAt, scannedAt } = value
  if (
    typeof id !== 'string' || typeof name !== 'string' || !isObject(ref) ||
    !isFiniteNumber(addedAt) || !(scannedAt === null || isFiniteNumber(scannedAt))
  ) return null
  return { id, name, ref: ref as FolderRef, addedAt, scannedAt }
}

/**
 * IndexedDB から読んだ値を写真として検証する。
 * @param value 読んだ値
 * @returns 写真。形が合わなければ `null`
 */
export const parsePhotoRecord = (value: unknown): PhotoRecord | null => {
  if (!isObject(value)) return null
  const { id, folderId, relativePath, name, size, lastModified, type, ref, status, addedAt, updatedAt } = value
  if (
    typeof id !== 'string' || typeof folderId !== 'string' || typeof relativePath !== 'string' ||
    typeof name !== 'string' || !isFiniteNumber(size) || !isFiniteNumber(lastModified) ||
    typeof type !== 'string' || !isObject(ref) || (status !== 'available' && status !== 'missing') ||
    !isFiniteNumber(addedAt) || !isFiniteNumber(updatedAt)
  ) return null
  return {
    id, folderId, relativePath, name, size, lastModified, type, ref: ref as FileRef, status, addedAt, updatedAt,
  }
}

/**
 * IndexedDB から読んだ値をサムネイルとして検証する。
 * ArrayBuffer は別の realm で作られることがあるため、`instanceof` ではなく型のタグで判定する。
 * @param value 読んだ値
 * @returns サムネイル。形が合わなければ `null`
 */
export const parseThumbnailRecord = (value: unknown): ThumbnailRecord | null => {
  if (!isObject(value)) return null
  const { photoId, size, lastModified, type, bytes, createdAt } = value
  if (
    typeof photoId !== 'string' || !isFiniteNumber(size) || !isFiniteNumber(lastModified) ||
    typeof type !== 'string' || Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' ||
    !isFiniteNumber(createdAt)
  ) return null
  return { photoId, size, lastModified, type, bytes: bytes as ArrayBuffer, createdAt }
}

/**
 * データベースのスキーマを作成・移行する。
 * @param db 開いているデータベース
 * @param oldVersion 移行前のバージョン。新規作成なら `0`
 */
const upgrade = (db: IDBPDatabase<LibrarySchema>, oldVersion: number) => {
  if (oldVersion < 1) {
    db.createObjectStore('folders', { keyPath: 'id' })
    const photos = db.createObjectStore('photos', { keyPath: 'id' })
    photos.createIndex('byFolder', 'folderId')
  }
  // バージョン 2 でサムネイルのキャッシュを追加した。既存のフォルダと写真はそのまま使える
  if (oldVersion < 2) db.createObjectStore('thumbnails', { keyPath: 'photoId' })
}

/**
 * メモリ上にだけ保存するライブラリを作る。IndexedDB を開けないときの代わりに使う。
 * ページを閉じると内容は失われる。
 * @returns メモリ上のライブラリ
 */
export const createMemoryLibraryStore = (): LibraryStore => {
  const folders = new Map<string, FolderRecord>()
  const photos = new Map<string, PhotoRecord>()
  const thumbnails = new Map<string, ThumbnailRecord>()
  return {
    /**
     * 保存済みのフォルダと写真をすべて返す。
     * @returns 保存済みの内容
     */
    load: async () => ({ folders: [...folders.values()], photos: [...photos.values()], skipped: 0 }),

    /**
     * フォルダを保存する。同じ ID があれば置き換える。
     * @param folder 保存するフォルダ
     */
    putFolder: async (folder) => {
      folders.set(folder.id, folder)
    },

    /**
     * 写真をまとめて保存する。同じ ID があれば置き換える。
     * @param records 保存する写真
     */
    putPhotos: async (records) => {
      for (const photo of records) photos.set(photo.id, photo)
    },

    /**
     * 写真のサムネイルを返す。
     * @param photoId 写真の ID
     * @returns サムネイル。なければ `null`
     */
    getThumbnail: async (photoId) => thumbnails.get(photoId) ?? null,

    /**
     * 写真のサムネイルを保存する。同じ写真のものがあれば置き換える。
     * @param thumbnail 保存するサムネイル
     */
    putThumbnail: async (thumbnail) => {
      thumbnails.set(thumbnail.photoId, thumbnail)
    },

    /** 何もしない。閉じる接続がないため。 */
    close: () => {},
  }
}

/**
 * IndexedDB のライブラリを開く。
 * @param name データベース名。テストで分けるときに指定する
 * @returns 開いたライブラリ
 */
export const openLibraryStore = async (name = DB_NAME): Promise<LibraryStore> => {
  const db = await openDB<LibrarySchema>(name, DB_VERSION, {
    /**
     * 新規作成やバージョンが上がったときにスキーマを作成・移行する。
     * @param database 開いているデータベース
     * @param oldVersion 移行前のバージョン
     */
    upgrade: (database, oldVersion) => upgrade(database, oldVersion),

    /**
     * 別のタブが新しいバージョンで開こうとしたら、移行を妨げないよう接続を閉じる。
     */
    blocking: () => db.close(),
  })

  return {
    /**
     * 保存済みのフォルダと写真をすべて読み込む。
     * 壊れたレコードと、登録されていないフォルダの写真は読み飛ばす。
     * @returns 読み込んだ内容
     */
    load: async () => {
      const tx = db.transaction(['folders', 'photos'])
      const [rawFolders, rawPhotos] = await Promise.all([
        tx.objectStore('folders').getAll() as Promise<unknown[]>,
        tx.objectStore('photos').getAll() as Promise<unknown[]>,
      ])
      await tx.done
      const folders = rawFolders.map(parseFolderRecord).filter((folder) => folder !== null)
      const folderIds = new Set(folders.map((folder) => folder.id))
      const photos = rawPhotos
        .map(parsePhotoRecord)
        .filter((photo): photo is PhotoRecord => photo !== null && folderIds.has(photo.folderId))
      return { folders, photos, skipped: rawFolders.length + rawPhotos.length - folders.length - photos.length }
    },

    /**
     * フォルダを保存する。同じ ID があれば置き換える。
     * @param folder 保存するフォルダ
     */
    putFolder: async (folder) => {
      await db.put('folders', folder)
    },

    /**
     * 写真を 1 つのトランザクションでまとめて保存する。同じ ID があれば置き換える。
     * @param photos 保存する写真
     */
    putPhotos: async (photos) => {
      const tx = db.transaction('photos', 'readwrite')
      await Promise.all([...photos.map((photo) => tx.store.put(photo)), tx.done])
    },

    /**
     * 写真のサムネイルを読む。壊れたレコードはないものとして扱う。
     * @param photoId 写真の ID
     * @returns サムネイル。なければ `null`
     */
    getThumbnail: async (photoId) => parseThumbnailRecord(await db.get('thumbnails', photoId)),

    /**
     * 写真のサムネイルを保存する。同じ写真のものがあれば置き換える。
     * @param thumbnail 保存するサムネイル
     */
    putThumbnail: async (thumbnail) => {
      await db.put('thumbnails', thumbnail)
    },

    /** データベースとの接続を閉じる。 */
    close: () => {
      db.close()
    },
  }
}
