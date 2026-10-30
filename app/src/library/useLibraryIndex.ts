import { useMemo } from 'react'
import type { PhotoRecord } from '../db/libraryStore'
import { byCollectionName, groupMemberships, matchesSearch, searchTerms } from './collections'
import { findReconnectCandidates } from './reconnect'
import type { Library } from './useLibrary'
import { byNewest, isInView, type View } from './view'

/** ライブラリの内容を、画面に出すために並べ替え・絞り込み・数え上げたもの */
export type LibraryIndex = ReturnType<typeof useLibraryIndex>

/**
 * ライブラリの内容を、画面に出すために並べ替え・絞り込み・数え上げる。
 * @param library ライブラリの状態
 * @param view 表示中の範囲
 * @param query 検索欄の入力
 * @returns 表示する写真、名前順のコレクション、所属関係、再接続の候補、各種の枚数、アクセスできるかの判定
 */
export const useLibraryIndex = (library: Library, view: View, query: string) => {
  const { folders, photos, collections, memberships, permissions } = library
  const folderNames = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders])
  const sortedPhotos = useMemo(() => [...photos].sort(byNewest(folderNames)), [photos, folderNames])
  const sortedCollections = useMemo(() => [...collections].sort(byCollectionName), [collections])
  const { collectionsByPhoto, photosByCollection } = useMemo(
    () => groupMemberships(memberships, new Set(photos.map((photo) => photo.id))),
    [memberships, photos],
  )
  const terms = useMemo(() => searchTerms(query), [query])
  const visiblePhotos = useMemo(() => sortedPhotos.filter((photo) => (
    isInView(photo, view, photosByCollection) &&
    matchesSearch(photo, folderNames.get(photo.folderId) ?? '', terms)
  )), [sortedPhotos, view, photosByCollection, folderNames, terms])
  const missingCount = useMemo(() => photos.filter((photo) => photo.status === 'missing').length, [photos])
  const candidatesByPhoto = useMemo(() => findReconnectCandidates(photos), [photos])
  const withCandidatesCount = [...candidatesByPhoto.values()].filter((candidates) => candidates.length > 0).length
  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>()
    for (const photo of photos) counts.set(photo.folderId, (counts.get(photo.folderId) ?? 0) + 1)
    return counts
  }, [photos])

  /**
   * 写真の入っているフォルダにアクセスできるか判定する。
   * @param photo 写真
   * @returns アクセスが許可されていれば `true`
   */
  const isAccessible = (photo: PhotoRecord) => permissions[photo.folderId] === 'granted'

  return {
    folderNames, sortedCollections, collectionsByPhoto, photosByCollection, visiblePhotos,
    searching: terms.length > 0, missingCount, candidatesByPhoto, withCandidatesCount, countsByFolder, isAccessible,
  }
}
