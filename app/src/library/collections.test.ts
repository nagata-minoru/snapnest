import { describe, expect, it } from 'vitest'
import type { CollectionRecord, MembershipRecord, PhotoRecord } from '../db/libraryStore'
import type { FileRef } from '../fs/photoSource'
import {
  byCollectionName, COLLECTION_NAME_MAX, groupMemberships, matchesSearch, searchTerms, validateCollectionName,
} from './collections'

/**
 * テスト用のコレクションを作る。
 * @param id コレクションの ID
 * @param name コレクション名
 * @param createdAt 作成日時
 * @returns コレクション
 */
const collectionOf = (id: string, name: string, createdAt = 1): CollectionRecord => ({
  id, name, createdAt, updatedAt: createdAt,
})

/**
 * テスト用の写真を作る。
 * @param relativePath フォルダ内の相対パス
 * @returns 写真
 */
const photoOf = (relativePath: string): PhotoRecord => ({
  id: `folder:${relativePath}`, folderId: 'folder', relativePath, name: relativePath.split('/').at(-1) ?? '',
  size: 1, lastModified: 1, type: 'image/jpeg', ref: {} as FileRef, status: 'available', addedAt: 1, updatedAt: 1,
})

/**
 * テスト用の所属を作る。
 * @param collectionId コレクションの ID
 * @param photoId 写真の ID
 * @returns 所属
 */
const membershipOf = (collectionId: string, photoId: string): MembershipRecord => ({
  collectionId, photoId, addedAt: 1,
})

describe('validateCollectionName', () => {
  const collections = [collectionOf('trip', 'Trip 2026')]

  it('前後の空白を除いた名前を返す', () => {
    expect(validateCollectionName('  お気に入り　', collections)).toEqual({ name: 'お気に入り' })
  })

  it('空の名前や長すぎる名前は使えない', () => {
    expect(validateCollectionName(' 　', collections)).toEqual({ error: '名前を入力してください。' })
    expect(validateCollectionName('あ'.repeat(COLLECTION_NAME_MAX), collections)).toHaveProperty('name')
    expect(validateCollectionName('あ'.repeat(COLLECTION_NAME_MAX + 1), collections)).toHaveProperty('error')
  })

  it('全角・半角や大文字・小文字だけが違う名前は重複とみなす', () => {
    expect(validateCollectionName('ｔｒｉｐ　２０２６', collections)).toEqual({
      error: '「ｔｒｉｐ　２０２６」という名前のコレクションはすでにあります。',
    })
  })

  it('名前を変えるコレクション自身とは重複とみなさない', () => {
    expect(validateCollectionName('trip 2026', collections, 'trip')).toEqual({ name: 'trip 2026' })
  })
})

describe('searchTerms と matchesSearch', () => {
  const photo = photoOf('2026/Trip/Station.PNG')

  it('空白で区切ったすべての語をフォルダ名と相対パスから探す', () => {
    expect(matchesSearch(photo, 'Pictures', searchTerms('trip　station'))).toBe(true)
    expect(matchesSearch(photo, 'Pictures', searchTerms('pictures png'))).toBe(true)
    expect(matchesSearch(photo, 'Pictures', searchTerms('trip morning'))).toBe(false)
  })

  it('全角・半角や大文字・小文字の違いを無視する', () => {
    expect(matchesSearch(photo, 'Pictures', searchTerms('ＳＴＡＴＩＯＮ'))).toBe(true)
  })

  it('語がなければすべての写真に一致する', () => {
    expect(searchTerms('  　')).toEqual([])
    expect(matchesSearch(photo, 'Pictures', [])).toBe(true)
  })
})

describe('groupMemberships', () => {
  it('写真ごと・コレクションごとにまとめ、ライブラリにない写真は数えない', () => {
    const { collectionsByPhoto, photosByCollection } = groupMemberships([
      membershipOf('trip', 'a'), membershipOf('best', 'a'), membershipOf('trip', 'b'), membershipOf('trip', 'gone'),
    ], new Set(['a', 'b']))

    expect(collectionsByPhoto.get('a')).toEqual(new Set(['trip', 'best']))
    expect(collectionsByPhoto.has('gone')).toBe(false)
    expect(photosByCollection.get('trip')).toEqual(new Set(['a', 'b']))
    expect(photosByCollection.get('best')?.size).toBe(1)
  })
})

describe('byCollectionName', () => {
  it('名前順に並べ、同じ名前なら作った順にする', () => {
    const sorted = [
      collectionOf('c', '旅行', 2), collectionOf('a', 'お気に入り'), collectionOf('b', '旅行', 1),
    ].sort(byCollectionName)

    expect(sorted.map((collection) => collection.id)).toEqual(['a', 'b', 'c'])
  })
})
