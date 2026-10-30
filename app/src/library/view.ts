import type { PhotoRecord } from '../db/libraryStore'

/** 写真一覧に表示する範囲 */
export type View = (
  { kind: 'all' } | { kind: 'missing' } | { kind: 'folder'; folderId: string } |
  { kind: 'collection'; collectionId: string }
)

/**
 * 写真を新しい順に並べる比較関数を作る。
 * 更新日時が同じなら相対パス順、それも同じならフォルダ名順にし、最後は ID で並びを固定する。
 * @param folderNames フォルダの ID ごとのフォルダ名
 * @returns 2 枚の写真の並び順を表す数を返す比較関数
 */
export const byNewest = (folderNames: ReadonlyMap<string, string>) => (a: PhotoRecord, b: PhotoRecord) => (
  b.lastModified - a.lastModified ||
  a.relativePath.localeCompare(b.relativePath) ||
  (folderNames.get(a.folderId) ?? '').localeCompare(folderNames.get(b.folderId) ?? '') ||
  a.id.localeCompare(b.id)
)

/**
 * 写真が表示範囲に含まれるか判定する。
 * @param photo 写真
 * @param view 表示範囲
 * @param photosByCollection コレクションごとの写真の ID
 * @returns 含まれるなら `true`
 */
export const isInView = (
  photo: PhotoRecord, view: View, photosByCollection: ReadonlyMap<string, ReadonlySet<string>>,
) => (
  view.kind === 'all' ||
  (view.kind === 'missing' && photo.status === 'missing') ||
  (view.kind === 'folder' && photo.folderId === view.folderId) ||
  (view.kind === 'collection' && !!photosByCollection.get(view.collectionId)?.has(photo.id))
)

/**
 * 表示範囲を比べるための文字列にする。
 * @param view 表示範囲
 * @returns 表示範囲ごとに異なる文字列
 */
export const viewKey = (view: View) => {
  if (view.kind === 'folder') return `folder:${view.folderId}`
  if (view.kind === 'collection') return `collection:${view.collectionId}`
  return view.kind
}
