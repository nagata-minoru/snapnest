import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FileRef, FolderRef } from '../fs/photoSource'

export const DB_NAME = 'snapnest'
export const DB_VERSION = 3

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

/** 写真をまとめるコレクション。写真そのものは持たず、所属は {@link MembershipRecord} で表す。 */
export type CollectionRecord = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** 写真がコレクションに所属していること。1 枚の写真は複数のコレクションに所属できる。 */
export type MembershipRecord = {
  collectionId: string
  photoId: string
  addedAt: number
}

interface LibrarySchema extends DBSchema {
  folders: { key: string; value: FolderRecord }
  photos: { key: string; value: PhotoRecord; indexes: { byFolder: string } }
  thumbnails: { key: string; value: ThumbnailRecord }
  collections: { key: string; value: CollectionRecord }
  memberships: {
    key: [string, string]
    value: MembershipRecord
    indexes: { byCollection: string; byPhoto: string }
  }
}

/** IndexedDB から読み込んだライブラリの内容。 */
export type LibrarySnapshot = {
  folders: FolderRecord[]
  photos: PhotoRecord[]
  collections: CollectionRecord[]
  memberships: MembershipRecord[]
  /** 壊れていて読み飛ばしたレコードの数 */
  skipped: number
}

/** ライブラリのメタデータを保存する場所。 */
export interface LibraryStore {
  /**
   * 保存済みのフォルダ、写真、コレクションと所属をすべて読み込む。壊れたレコードは読み飛ばす。
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

  /**
   * コレクションを保存する。同じ ID があれば置き換える。
   * @param collection 保存するコレクション
   */
  putCollection(collection: CollectionRecord): Promise<void>

  /**
   * コレクションと、そこへの所属をまとめて削除する。写真は削除しない。
   * @param collectionId 削除するコレクションの ID
   */
  deleteCollection(collectionId: string): Promise<void>

  /**
   * 写真をコレクションに所属させる。所属済みなら置き換える。
   * @param membership 保存する所属
   */
  putMembership(membership: MembershipRecord): Promise<void>

  /**
   * 写真をコレクションから外す。所属していなければ何もしない。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   */
  deleteMembership(collectionId: string, photoId: string): Promise<void>

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
 * IndexedDB から読んだ値をコレクションとして検証する。
 * @param value 読んだ値
 * @returns コレクション。形が合わなければ `null`
 */
export const parseCollectionRecord = (value: unknown): CollectionRecord | null => {
  if (!isObject(value)) return null
  const { id, name, createdAt, updatedAt } = value
  if (
    typeof id !== 'string' || typeof name !== 'string' || !isFiniteNumber(createdAt) || !isFiniteNumber(updatedAt)
  ) return null
  return { id, name, createdAt, updatedAt }
}

/**
 * IndexedDB から読んだ値を所属として検証する。
 * @param value 読んだ値
 * @returns 所属。形が合わなければ `null`
 */
export const parseMembershipRecord = (value: unknown): MembershipRecord | null => {
  if (!isObject(value)) return null
  const { collectionId, photoId, addedAt } = value
  if (typeof collectionId !== 'string' || typeof photoId !== 'string' || !isFiniteNumber(addedAt)) return null
  return { collectionId, photoId, addedAt }
}

/**
 * 読み込んだ値を検証し、壊れたものを除く。
 * @param values 読み込んだ値
 * @param parse 1 件を検証する関数
 * @returns 正しいレコードと、除いた数
 */
const parseAll = <T>(values: unknown[], parse: (value: unknown) => T | null) => {
  const records = values.map(parse).filter((record) => record !== null)
  return { records, skipped: values.length - records.length }
}

/**
 * フォルダと写真の検証結果に、コレクションと所属の検証結果を合わせる。
 * 登録されていないフォルダの写真は、壊れたものとして除く。
 * 削除されたコレクションへの所属は、削除の途中で残ったものとして、壊れたものとは数えずに除く。
 * @param raw 各ストアから読み込んだ値
 * @returns 読み込んだ内容
 */
const toSnapshot = (raw: {
  folders: unknown[]
  photos: unknown[]
  collections: unknown[]
  memberships: unknown[]
}): LibrarySnapshot => {
  const folders = parseAll(raw.folders, parseFolderRecord)
  const folderIds = new Set(folders.records.map((folder) => folder.id))
  const photos = raw.photos
    .map(parsePhotoRecord)
    .filter((photo): photo is PhotoRecord => photo !== null && folderIds.has(photo.folderId))
  const collections = parseAll(raw.collections, parseCollectionRecord)
  const collectionIds = new Set(collections.records.map((collection) => collection.id))
  const memberships = parseAll(raw.memberships, parseMembershipRecord)
  return {
    folders: folders.records,
    photos,
    collections: collections.records,
    memberships: memberships.records.filter((membership) => collectionIds.has(membership.collectionId)),
    skipped: folders.skipped + raw.photos.length - photos.length + collections.skipped + memberships.skipped,
  }
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

  // バージョン 3 でコレクションを追加した。所属は写真を複製せず、コレクションと写真の ID の組で持つ
  if (oldVersion < 3) {
    db.createObjectStore('collections', { keyPath: 'id' })
    const memberships = db.createObjectStore('memberships', { keyPath: ['collectionId', 'photoId'] })
    memberships.createIndex('byCollection', 'collectionId')
    memberships.createIndex('byPhoto', 'photoId')
  }
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
  const collections = new Map<string, CollectionRecord>()
  const memberships = new Map<string, MembershipRecord>()

  /**
   * 所属を保存するときのキーを作る。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   * @returns キー
   */
  const membershipKey = (collectionId: string, photoId: string) => JSON.stringify([collectionId, photoId])

  return {
    /**
     * 保存済みの内容をすべて返す。
     * @returns 保存済みの内容
     */
    load: async () => ({
      folders: [...folders.values()],
      photos: [...photos.values()],
      collections: [...collections.values()],
      memberships: [...memberships.values()],
      skipped: 0,
    }),

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

    /**
     * コレクションを保存する。同じ ID があれば置き換える。
     * @param collection 保存するコレクション
     */
    putCollection: async (collection) => {
      collections.set(collection.id, collection)
    },

    /**
     * コレクションと、そこへの所属を削除する。
     * @param collectionId 削除するコレクションの ID
     */
    deleteCollection: async (collectionId) => {
      collections.delete(collectionId)
      for (const [key, membership] of memberships) {
        if (membership.collectionId === collectionId) memberships.delete(key)
      }
    },

    /**
     * 写真をコレクションに所属させる。
     * @param membership 保存する所属
     */
    putMembership: async (membership) => {
      memberships.set(membershipKey(membership.collectionId, membership.photoId), membership)
    },

    /**
     * 写真をコレクションから外す。
     * @param collectionId コレクションの ID
     * @param photoId 写真の ID
     */
    deleteMembership: async (collectionId, photoId) => {
      memberships.delete(membershipKey(collectionId, photoId))
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
     * 保存済みの内容をすべて読み込む。
     * 壊れたレコードと、登録されていないフォルダの写真、削除されたコレクションへの所属は読み飛ばす。
     * @returns 読み込んだ内容
     */
    load: async () => {
      const tx = db.transaction(['folders', 'photos', 'collections', 'memberships'])
      const [folders, photos, collections, memberships] = await Promise.all([
        tx.objectStore('folders').getAll() as Promise<unknown[]>,
        tx.objectStore('photos').getAll() as Promise<unknown[]>,
        tx.objectStore('collections').getAll() as Promise<unknown[]>,
        tx.objectStore('memberships').getAll() as Promise<unknown[]>,
      ])
      await tx.done
      return toSnapshot({ folders, photos, collections, memberships })
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

    /**
     * コレクションを保存する。同じ ID があれば置き換える。
     * @param collection 保存するコレクション
     */
    putCollection: async (collection) => {
      await db.put('collections', collection)
    },

    /**
     * コレクションと、そこへの所属を 1 つのトランザクションでまとめて削除する。
     * @param collectionId 削除するコレクションの ID
     */
    deleteCollection: async (collectionId) => {
      const tx = db.transaction(['collections', 'memberships'], 'readwrite')
      const memberships = tx.objectStore('memberships')
      const keys = await memberships.index('byCollection').getAllKeys(collectionId)
      await Promise.all([
        tx.objectStore('collections').delete(collectionId),
        ...keys.map((key) => memberships.delete(key)),
        tx.done,
      ])
    },

    /**
     * 写真をコレクションに所属させる。所属済みなら置き換える。
     * @param membership 保存する所属
     */
    putMembership: async (membership) => {
      await db.put('memberships', membership)
    },

    /**
     * 写真をコレクションから外す。
     * @param collectionId コレクションの ID
     * @param photoId 写真の ID
     */
    deleteMembership: async (collectionId, photoId) => {
      await db.delete('memberships', [collectionId, photoId])
    },

    /** データベースとの接続を閉じる。 */
    close: () => {
      db.close()
    },
  }
}
