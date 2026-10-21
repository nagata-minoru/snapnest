import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import type { FileRef, FolderRef } from '../fs/photoSource'
import {
  createMemoryLibraryStore, DB_NAME, DB_VERSION, openLibraryStore, type FolderRecord, type LibraryStore,
  type PhotoRecord, type ThumbnailRecord,
} from './libraryStore'

const folder: FolderRecord = {
  id: 'folder', name: 'Pictures', ref: {} as FolderRef, addedAt: 1, scannedAt: 2,
}

const photo: PhotoRecord = {
  id: 'folder:morning.jpg', folderId: 'folder', relativePath: 'morning.jpg', name: 'morning.jpg', size: 5,
  lastModified: 3, type: 'image/jpeg', ref: {} as FileRef, status: 'available', addedAt: 4, updatedAt: 5,
}

/**
 * テスト用のサムネイルを作る。
 * @param content 画像の内容として入れる文字列
 * @returns サムネイル
 */
const thumbnailOf = async (content: string): Promise<ThumbnailRecord> => ({
  photoId: photo.id,
  size: photo.size,
  lastModified: photo.lastModified,
  type: 'image/webp',
  bytes: await new Blob([content]).arrayBuffer(),
  createdAt: 6,
})

/**
 * サムネイルの内容を文字列として読む。
 * @param thumbnail サムネイル
 * @returns 画像の内容
 */
const contentOf = (thumbnail: ThumbnailRecord | null) => (
  thumbnail && new Blob([thumbnail.bytes], { type: thumbnail.type }).text()
)

describe.each([{
  name: 'IndexedDB', open: () => openLibraryStore(),
}, {
  name: 'メモリ', open: async () => createMemoryLibraryStore(),
}])('$name のサムネイル', ({ open }: { open: () => Promise<LibraryStore> }) => {
  it('保存したサムネイルを読み、同じ写真のものは置き換える', async () => {
    const store = await open()

    expect(await store.getThumbnail(photo.id)).toBeNull()

    await store.putThumbnail(await thumbnailOf('first'))
    await store.putThumbnail(await thumbnailOf('second'))

    const thumbnail = await store.getThumbnail(photo.id)
    expect(thumbnail).toMatchObject({ photoId: photo.id, size: 5, lastModified: 3, type: 'image/webp' })
    expect(await contentOf(thumbnail)).toBe('second')
    store.close()
  })
})

describe('openLibraryStore', () => {
  it('バージョン 1 のデータベースを移行し、既存のフォルダと写真を残す', async () => {
    const old = await openDB(DB_NAME, 1, {
      /**
       * バージョン 1 のスキーマを作る。
       * @param db 開いているデータベース
       */
      upgrade: (db) => {
        db.createObjectStore('folders', { keyPath: 'id' })
        db.createObjectStore('photos', { keyPath: 'id' }).createIndex('byFolder', 'folderId')
      },
    })
    await old.put('folders', folder)
    await old.put('photos', photo)
    old.close()

    const store = await openLibraryStore()

    expect(await store.load()).toEqual({ folders: [folder], photos: [photo], skipped: 0 })
    expect(await store.getThumbnail(photo.id)).toBeNull()
    await store.putThumbnail(await thumbnailOf('thumb'))
    expect(await contentOf(await store.getThumbnail(photo.id))).toBe('thumb')
    store.close()

    const db = await openDB(DB_NAME)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames]).toEqual(['folders', 'photos', 'thumbnails'])
    db.close()
  })

  it('壊れたサムネイルはないものとして扱う', async () => {
    const store = await openLibraryStore()
    store.close()
    const db = await openDB(DB_NAME)
    await db.put('thumbnails', { photoId: photo.id, size: 5, lastModified: 3, type: 'image/webp', bytes: 'x' })
    await db.put('thumbnails', { photoId: 'other' })
    db.close()

    const reopened = await openLibraryStore()

    expect(await reopened.getThumbnail(photo.id)).toBeNull()
    expect(await reopened.getThumbnail('other')).toBeNull()
    reopened.close()
  })
})
