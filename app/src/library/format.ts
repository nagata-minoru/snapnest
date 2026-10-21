import { extensionOf } from '../fs/photoSource'

const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric' })

/**
 * 日時を「2026年10月18日」の形にする。
 * @param time 日時（ミリ秒）
 * @returns 整形した日付
 */
export const formatDate = (time: number) => dateFormat.format(time)

/**
 * 日時を「10月18日」の形にする。
 * @param time 日時（ミリ秒）
 * @returns 整形した日付
 */
export const formatShortDate = (time: number) => shortDateFormat.format(time)

/**
 * バイト数を読みやすい単位にする。
 * @param bytes バイト数
 * @returns 「4.8 MB」のような文字列
 */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/**
 * ファイル名から画像の形式名を求める。
 * @param name ファイル名
 * @returns 「JPEG」のような形式名
 */
export const formatKind = (name: string) => {
  const extension = extensionOf(name)
  return extension === 'jpg' ? 'JPEG' : extension.toUpperCase()
}

/**
 * 相対パスからファイル名を除いたフォルダ部分を、表示用の区切りで返す。
 * @param relativePath フォルダからの相対パス
 * @returns 「2026 / 10」のような文字列。直下のファイルなら空文字列
 */
export const formatDirectory = (relativePath: string) => relativePath.split('/').slice(0, -1).join(' / ')

/**
 * 写真の保存場所を、フォルダ名と相対パスで表す。
 * @param folderName フォルダ名。フォルダが見つからなければ `undefined`
 * @param relativePath フォルダからの相対パス
 * @returns 「Pictures / trip / station.png」のような文字列
 */
export const formatLocation = (folderName: string | undefined, relativePath: string) => (
  [folderName ?? '不明なフォルダ', ...relativePath.split('/')].join(' / ')
)
