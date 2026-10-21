import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import type { FileRef, FolderRef } from '../fs/photoSource'
import {
  createMemoryLibraryStore, DB_NAME, DB_VERSION, openLibraryStore, type CollectionRecord, type FolderRecord,
  type LibraryStore, type MembershipRecord, type PhotoRecord, type ThumbnailRecord,
} from './libraryStore'

const folder: FolderRecord = {
  id: 'folder', name: 'Pictures', ref: {} as FolderRef, addedAt: 1, scannedAt: 2,
}

const photo: PhotoRecord = {
  id: 'folder:morning.jpg', folderId: 'folder', relativePath: 'morning.jpg', name: 'morning.jpg', size: 5,
  lastModified: 3, type: 'image/jpeg', ref: {} as FileRef, status: 'available', addedAt: 4, updatedAt: 5,
}

/**
 * テスト用のコレクションを作る。
 * @param id コレクションの ID
 * @param name コレクション名
 * @returns コレクション
 */
const collectionOf = (id: string, name: string): CollectionRecord => ({ id, name, createdAt: 7, updatedAt: 8 })

/**
 * テスト用の所属を作る。
 * @param collectionId コレクションの ID
 * @param photoId 写真の ID
 * @returns 所属
 */
const membershipOf = (collectionId: string, photoId = photo.id): MembershipRecord => ({
  collectionId, photoId, addedAt: 9,
})

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

describe.each([{
  name: 'IndexedDB', open: () => openLibraryStore(),
}, {
  name: 'メモリ', open: async () => createMemoryLibraryStore(),
}])('$name のコレクション', ({ open }: { open: () => Promise<LibraryStore> }) => {
  it('コレクションと所属を保存し、名前の変更は置き換える', async () => {
    const store = await open()
    await store.putFolder(folder)
    await store.putPhotos([photo])

    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putCollection(collectionOf('trip', '旅行 2026'))
    await store.putCollection(collectionOf('best', 'お気に入り'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('best'))

    const { collections, memberships } = await store.load()
    expect(collections.map((collection) => collection.name).sort()).toEqual(['お気に入り', '旅行 2026'])
    expect(memberships.map((membership) => membership.collectionId).sort()).toEqual(['best', 'trip'])
    store.close()
  })

  it('所属を外しても、写真やほかのコレクションへの所属は残す', async () => {
    const store = await open()
    await store.putFolder(folder)
    await store.putPhotos([photo])
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putCollection(collectionOf('best', 'お気に入り'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('best'))

    await store.deleteMembership('trip', photo.id)
    await store.deleteMembership('trip', 'none')

    const snapshot = await store.load()
    expect(snapshot.photos).toEqual([photo])
    expect(snapshot.memberships).toEqual([membershipOf('best')])
    store.close()
  })

  it('コレクションを削除すると所属も消え、写真は残す', async () => {
    const store = await open()
    await store.putFolder(folder)
    await store.putPhotos([photo])
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putCollection(collectionOf('best', 'お気に入り'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('best'))

    await store.deleteCollection('trip')

    const snapshot = await store.load()
    expect(snapshot.photos).toEqual([photo])
    expect(snapshot.collections).toEqual([collectionOf('best', 'お気に入り')])
    expect(snapshot.memberships).toEqual([membershipOf('best')])
    store.close()
  })
})

describe.each([{
  name: 'IndexedDB', open: () => openLibraryStore(),
}, {
  name: 'メモリ', open: async () => createMemoryLibraryStore(),
}])('$name の再接続', ({ open }: { open: () => Promise<LibraryStore> }) => {
  const missing: PhotoRecord = { ...photo, status: 'missing' }
  const moved: PhotoRecord = { ...photo, id: 'folder:2026/morning.jpg', relativePath: '2026/morning.jpg' }

  it('所属を引き継ぎ、見つからない写真の記録とサムネイルを消す', async () => {
    const store = await open()
    await store.putFolder(folder)
    await store.putPhotos([missing, moved])
    await store.putThumbnail(await thumbnailOf('old'))
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putCollection(collectionOf('best', 'お気に入り'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('best'))
    await store.putMembership({ ...membershipOf('best', moved.id), addedAt: 1 })

    await store.reconnectPhoto(missing.id, { ...moved, addedAt: 1 })

    const snapshot = await store.load()
    expect(snapshot.photos).toEqual([{ ...moved, addedAt: 1 }])
    expect(snapshot.memberships.sort((a, b) => a.collectionId.localeCompare(b.collectionId))).toEqual([
      { ...membershipOf('best', moved.id), addedAt: 1 }, membershipOf('trip', moved.id),
    ])
    expect(await store.getThumbnail(missing.id)).toBeNull()
    store.close()
  })

  it('写真の記録を、所属・サムネイルとまとめて消し、ほかの写真は残す', async () => {
    const store = await open()
    await store.putFolder(folder)
    await store.putPhotos([missing, moved])
    await store.putThumbnail(await thumbnailOf('old'))
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putMembership(membershipOf('trip'))
    await store.putMembership(membershipOf('trip', moved.id))

    await store.deletePhoto(missing.id)

    const snapshot = await store.load()
    expect(snapshot.photos).toEqual([moved])
    expect(snapshot.memberships).toEqual([membershipOf('trip', moved.id)])
    expect(await store.getThumbnail(missing.id)).toBeNull()
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

    expect(await store.load()).toEqual({
      folders: [folder], photos: [photo], collections: [], memberships: [], skipped: 0,
    })
    expect(await store.getThumbnail(photo.id)).toBeNull()
    await store.putThumbnail(await thumbnailOf('thumb'))
    expect(await contentOf(await store.getThumbnail(photo.id))).toBe('thumb')
    store.close()

    const db = await openDB(DB_NAME)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames]).toEqual(['collections', 'folders', 'memberships', 'photos', 'thumbnails'])
    db.close()
  })

  it('バージョン 2 のデータベースを移行し、既存のサムネイルを残す', async () => {
    const old = await openDB(DB_NAME, 2, {
      /**
       * バージョン 2 のスキーマを作る。
       * @param db 開いているデータベース
       */
      upgrade: (db) => {
        db.createObjectStore('folders', { keyPath: 'id' })
        db.createObjectStore('photos', { keyPath: 'id' }).createIndex('byFolder', 'folderId')
        db.createObjectStore('thumbnails', { keyPath: 'photoId' })
      },
    })
    await old.put('folders', folder)
    await old.put('photos', photo)
    await old.put('thumbnails', await thumbnailOf('kept'))
    old.close()

    const store = await openLibraryStore()

    expect(await store.load()).toEqual({
      folders: [folder], photos: [photo], collections: [], memberships: [], skipped: 0,
    })
    expect(await contentOf(await store.getThumbnail(photo.id))).toBe('kept')
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putMembership(membershipOf('trip'))
    expect((await store.load()).memberships).toEqual([membershipOf('trip')])
    store.close()
  })

  it('壊れたコレクションや所属は読み飛ばし、削除済みのコレクションへの所属は黙って除く', async () => {
    const store = await openLibraryStore()
    await store.putFolder(folder)
    await store.putPhotos([photo])
    await store.putCollection(collectionOf('trip', '旅行'))
    await store.putMembership(membershipOf('trip'))
    store.close()
    const db = await openDB(DB_NAME)
    await db.put('collections', { id: 'broken', name: 3 })
    await db.put('memberships', { collectionId: 'trip', photoId: 'x', addedAt: 'yesterday' })
    await db.put('memberships', membershipOf('deleted'))
    db.close()

    const reopened = await openLibraryStore()
    const snapshot = await reopened.load()

    expect(snapshot.collections).toEqual([collectionOf('trip', '旅行')])
    expect(snapshot.memberships).toEqual([membershipOf('trip')])
    expect(snapshot.skipped).toBe(2)
    reopened.close()
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
