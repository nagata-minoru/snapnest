import type { CollectionRecord, MembershipRecord, PhotoRecord } from '../db/libraryStore'

/** コレクション名の最大の長さ（文字数） */
export const COLLECTION_NAME_MAX = 40

/**
 * 比べるために文字列を正規化する。全角・半角の英数字や大文字・小文字の違いを無視できるようにする。
 * @param text 正規化する文字列
 * @returns 正規化した文字列
 */
export const normalizeText = (text: string) => text.normalize('NFKC').toLowerCase()

/**
 * 入力されたコレクション名を検証する。前後の空白は除く。
 * @param input 入力された名前
 * @param collections 既存のコレクション
 * @param exceptId 名前を変えるコレクションの ID。重複の確認から除く
 * @returns 使える名前、または利用者に伝える理由
 */
export const validateCollectionName = (
  input: string,
  collections: readonly CollectionRecord[],
  exceptId?: string,
): { name: string } | { error: string } => {
  const name = input.trim()
  if (!name) return { error: '名前を入力してください。' }
  if ([...name].length > COLLECTION_NAME_MAX) return { error: `名前は ${COLLECTION_NAME_MAX} 文字以内にしてください。` }
  const key = normalizeText(name)
  if (collections.some((collection) => collection.id !== exceptId && normalizeText(collection.name) === key)) {
    return { error: `「${name}」という名前のコレクションはすでにあります。` }
  }
  return { name }
}

/**
 * 検索語を語に分ける。空白（全角を含む）で区切り、正規化する。
 * @param query 入力された検索語
 * @returns 正規化した語。何も入力されていなければ空の配列
 */
export const searchTerms = (query: string) => normalizeText(query).split(/\s+/).filter(Boolean)

/**
 * 写真が検索語のすべての語に一致するか判定する。フォルダ名と、フォルダ内の相対パスを対象にする。
 * @param photo 写真
 * @param folderName 写真が入っているフォルダの名前
 * @param terms {@link searchTerms} で分けた語
 * @returns すべての語を含めば `true`。語がなければ常に `true`
 */
export const matchesSearch = (photo: PhotoRecord, folderName: string, terms: readonly string[]) => {
  if (terms.length === 0) return true
  const target = normalizeText(`${folderName}/${photo.relativePath}`)
  return terms.every((term) => target.includes(term))
}

/**
 * 所属を写真ごと・コレクションごとにまとめる。ライブラリにない写真への所属は数えない。
 * @param memberships 所属
 * @param photoIds ライブラリにある写真の ID
 * @returns 写真ごとの所属先コレクションの ID と、コレクションごとの写真の ID
 */
export const groupMemberships = (memberships: readonly MembershipRecord[], photoIds: ReadonlySet<string>) => {
  const collectionsByPhoto = new Map<string, Set<string>>()
  const photosByCollection = new Map<string, Set<string>>()
  for (const { collectionId, photoId } of memberships) {
    if (!photoIds.has(photoId)) continue
    if (!collectionsByPhoto.has(photoId)) collectionsByPhoto.set(photoId, new Set())
    collectionsByPhoto.get(photoId)?.add(collectionId)
    if (!photosByCollection.has(collectionId)) photosByCollection.set(collectionId, new Set())
    photosByCollection.get(collectionId)?.add(photoId)
  }
  return { collectionsByPhoto, photosByCollection }
}

/**
 * コレクションを名前順に並べるための比較関数。
 * @param a 比べるコレクション
 * @param b 比べるコレクション
 * @returns 並び順を表す数
 */
export const byCollectionName = (a: CollectionRecord, b: CollectionRecord) => (
  a.name.localeCompare(b.name, 'ja') || a.createdAt - b.createdAt
)
