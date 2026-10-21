import { describe, expect, it } from 'vitest'
import type { PhotoRecord, PhotoStatus } from '../db/libraryStore'
import type { FileRef } from '../fs/photoSource'
import { describeMatch, findReconnectCandidates } from './reconnect'

/**
 * テスト用の写真を作る。
 * @param relativePath フォルダ内の相対パス
 * @param options.size サイズ
 * @param options.lastModified 更新日時
 * @param options.status 参照できるか
 * @returns 写真
 */
const photoOf = (relativePath: string, { size = 5, lastModified = 1, status = 'available' }: {
  size?: number
  lastModified?: number
  status?: PhotoStatus
} = {}): PhotoRecord => ({
  id: relativePath, folderId: 'folder', relativePath, name: relativePath.split('/').at(-1) ?? '',
  size, lastModified, type: 'image/jpeg', ref: {} as FileRef, status, addedAt: 1, updatedAt: 1,
})

/**
 * 候補の相対パスを取り出す。
 * @param photos ライブラリのすべての写真
 * @param missingId 見つからない写真の ID
 * @returns 候補の相対パス
 */
const candidatePaths = (photos: PhotoRecord[], missingId: string) => (
  findReconnectCandidates(photos).get(missingId)?.map((candidate) => candidate.photo.relativePath)
)

describe('findReconnectCandidates', () => {
  it('サイズが同じで、名前か更新日時も同じ写真を候補にする', () => {
    const photos = [
      photoOf('old/station.png', { status: 'missing' }),
      photoOf('new/station.png'),
      photoOf('new/renamed.png'),
      photoOf('new/station-copy.png', { lastModified: 2 }),
      photoOf('new/station.jpg', { size: 6 }),
    ]

    expect(candidatePaths(photos, 'old/station.png')).toEqual(['new/station.png', 'new/renamed.png'])
  })

  it('一致した項目が多い順に並べる', () => {
    const photos = [
      photoOf('old/station.png', { status: 'missing' }),
      photoOf('a/station.png', { lastModified: 2 }),
      photoOf('b/renamed.png'),
      photoOf('c/station.png'),
    ]

    const candidates = findReconnectCandidates(photos).get('old/station.png') ?? []
    expect(candidates.map((candidate) => candidate.photo.relativePath)).toEqual([
      'c/station.png', 'a/station.png', 'b/renamed.png',
    ])
    expect(candidates[0].match).toEqual({ name: true, size: true, lastModified: true })
  })

  it('名前は大文字・小文字や濁点の合成・分解の違いを無視する', () => {
    const photos = [
      photoOf('old/ガラス.PNG', { status: 'missing', lastModified: 1 }),
      photoOf('new/ガラス.png'.normalize('NFD'), { lastModified: 2 }),
    ]

    expect(candidatePaths(photos, 'old/ガラス.PNG')).toHaveLength(1)
  })

  it('見つからない写真どうしは候補にせず、候補がなければ空にする', () => {
    const photos = [photoOf('a.png', { status: 'missing' }), photoOf('b/a.png', { status: 'missing' })]

    expect(candidatePaths(photos, 'a.png')).toEqual([])
    expect(findReconnectCandidates([photoOf('a.png')]).size).toBe(0)
  })

  it('複数の見つからない写真の候補になっている写真に印を付ける', () => {
    const photos = [
      photoOf('old/a.png', { status: 'missing' }),
      photoOf('copy/a.png', { status: 'missing' }),
      photoOf('new/a.png'),
    ]
    const candidates = findReconnectCandidates(photos)

    expect(candidates.get('old/a.png')?.map((candidate) => candidate.shared)).toEqual([true])
    expect(candidates.get('copy/a.png')?.map((candidate) => candidate.shared)).toEqual([true])
    expect(findReconnectCandidates(photos.slice(1)).get('copy/a.png')?.[0].shared).toBe(false)
  })
})

describe('describeMatch', () => {
  it('一致した項目と異なる項目を伝える', () => {
    expect(describeMatch({ name: true, size: true, lastModified: true })).toBe('名前・サイズ・更新日時が一致')
    expect(describeMatch({ name: false, size: true, lastModified: true })).toBe(
      'サイズ・更新日時が一致（名前は異なる）',
    )
  })
})
