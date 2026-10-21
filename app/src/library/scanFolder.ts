import type { FolderRecord, LibraryStore, PhotoRecord } from '../db/libraryStore'
import type { PhotoSource, ScannedFile } from '../fs/photoSource'

/** 一度に保存・画面へ反映する写真の数 */
const BATCH_SIZE = 100

/** フォルダ読み込みの結果。 */
export type ScanOutcome = {
  found: number
  added: number
  /** 前回まであったが今回見つからなかった写真 */
  missing: PhotoRecord[]
}

/** フォルダ読み込みの途中で失敗したことを表す例外。 */
export class ScanError extends Error {
  /**
   * 途中までに見つけた写真の数と、元の例外を持つ例外を作る。
   * @param found 失敗するまでに見つけた写真の数
   * @param cause 元の例外
   */
  constructor(readonly found: number, cause: unknown) {
    super('フォルダの読み込みに失敗しました。', { cause })
  }
}

/**
 * 写真の ID を作る。同じフォルダの同じ相対パスなら同じ ID になる。
 * @param folderId フォルダの ID
 * @param relativePath フォルダからの相対パス
 * @returns 写真の ID
 */
export const photoIdOf = (folderId: string, relativePath: string) => `${folderId}:${relativePath}`

/**
 * 見つかったファイルから写真のレコードを作る。既存のレコードがあれば登録日時を引き継ぐ。
 * @param folderId フォルダの ID
 * @param file 見つかったファイル
 * @param previous 同じパスの既存レコード
 * @param now 現在日時
 * @returns 写真のレコード
 */
const toPhotoRecord = (
  folderId: string,
  file: ScannedFile,
  previous: PhotoRecord | undefined,
  now: number,
): PhotoRecord => ({
  id: photoIdOf(folderId, file.relativePath),
  folderId,
  relativePath: file.relativePath,
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
  type: file.type,
  ref: file.ref,
  status: 'available',
  addedAt: previous?.addedAt ?? now,
  updatedAt: now,
})

/**
 * フォルダ内の画像を読み込み、メタデータを保存する。
 * 最後まで読めたときだけ、見つからなかった既存の写真を `missing` にする。
 * 途中で失敗した場合はそれまでの分を保存したまま {@link ScanError} を投げる。
 * @param options.source ファイルアクセスの抽象化レイヤー
 * @param options.store メタデータの保存先
 * @param options.folder 読み込むフォルダ
 * @param options.existing このフォルダの既存の写真
 * @param options.onBatch 写真をまとめて保存するたびに呼ばれる。引数は保存した写真と、それまでに見つけた数
 * @param options.now 現在日時を返す関数
 * @returns 読み込みの結果
 */
export const scanFolder = async ({ source, store, folder, existing, onBatch, now = Date.now }: {
  source: PhotoSource
  store: LibraryStore
  folder: FolderRecord
  existing: PhotoRecord[]
  onBatch: (photos: PhotoRecord[], found: number) => void
  now?: () => number
}): Promise<ScanOutcome> => {
  const previousByPath = new Map(existing.map((photo) => [photo.relativePath, photo]))
  const seen = new Set<string>()
  let batch: PhotoRecord[] = []
  let found = 0
  let added = 0

  /** たまった写真を保存し、画面へ知らせる。 */
  const flush = async () => {
    if (!batch.length) return
    const photos = batch
    batch = []
    await store.putPhotos(photos)
    onBatch(photos, found)
  }

  try {
    for await (const file of source.scanImages(folder.ref)) {
      if (seen.has(file.relativePath)) continue
      seen.add(file.relativePath)
      const previous = previousByPath.get(file.relativePath)
      if (!previous) added += 1
      found += 1
      batch.push(toPhotoRecord(folder.id, file, previous, now()))
      if (batch.length >= BATCH_SIZE) await flush()
    }
    await flush()
  } catch (error) {
    throw new ScanError(found, error)
  }

  const timestamp = now()
  const missing = existing
    .filter((photo) => !seen.has(photo.relativePath) && photo.status !== 'missing')
    .map((photo): PhotoRecord => ({ ...photo, status: 'missing', updatedAt: timestamp }))
  if (missing.length) await store.putPhotos(missing)
  await store.putFolder({ ...folder, scannedAt: timestamp })

  return { found, added, missing }
}
