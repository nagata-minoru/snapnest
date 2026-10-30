import type {
  AccessPermission, FileRef, FolderRef, PhotoSource, ReadResult, ScannedFile, SourceSupport,
} from './photoSource'
import { isImageFileName, unsupportedMessage } from './photoSource'

// TypeScript の DOM 型定義にない File System Access API の部分だけを最小限に定義する。

type PermissionMode = { mode: 'read' }

type PermissionMethods = {
  queryPermission?(descriptor: PermissionMode): Promise<PermissionState>
  requestPermission?(descriptor: PermissionMode): Promise<PermissionState>
}

type FileHandle = Pick<FileSystemFileHandle, 'kind' | 'name' | 'getFile'>

type DirectoryHandle = PermissionMethods & {
  readonly kind: 'directory'
  readonly name: string
  isSameEntry(other: DirectoryHandle): Promise<boolean>
  values(): AsyncIterable<FileHandle | DirectoryHandle>
}

/** File System Access API のうち、このアダプターが使う大域関数と、安全な接続で開かれているか。 */
export type DirectoryPickerHost = {
  showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<DirectoryHandle>
  readonly isSecureContext?: boolean
}

/**
 * 値がディレクトリのハンドルらしいか判定する。保存データの破損に備えて使う。
 * @param value 判定する値
 * @returns ディレクトリのハンドルとして扱えるなら `true`
 */
const isDirectoryHandle = (value: unknown): value is DirectoryHandle => (
  typeof value === 'object' && value !== null &&
  (value as { kind?: unknown }).kind === 'directory' &&
  typeof (value as { values?: unknown }).values === 'function'
)

/**
 * 値がファイルのハンドルらしいか判定する。保存データの破損に備えて使う。
 * @param value 判定する値
 * @returns ファイルのハンドルとして扱えるなら `true`
 */
const isFileHandle = (value: unknown): value is FileHandle => (
  typeof value === 'object' && value !== null &&
  (value as { kind?: unknown }).kind === 'file' &&
  typeof (value as { getFile?: unknown }).getFile === 'function'
)

/**
 * 例外の DOMException 名を取り出す。
 * @param error 捕まえた例外
 * @returns 例外の名前。名前がなければ空文字列
 */
const errorName = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return ''
  const { name } = error as { name?: unknown }
  if (typeof name !== 'string') return ''
  return name
}

/**
 * ブラウザの権限状態を snapnest の権限状態に変換する。
 * @param state ブラウザが返した権限状態
 * @returns 対応する権限状態
 */
const toAccessPermission = (state: PermissionState): AccessPermission => (
  state === 'granted' ? 'granted' : state === 'prompt' ? 'prompt' : 'denied'
)

/**
 * ディレクトリ以下の画像ファイルを再帰的に列挙する。
 * 隠しフォルダは辿らない。個々のファイルが読めない場合は飛ばす。
 * @param directory 列挙するディレクトリ
 * @param prefix 選択したフォルダからの相対パスの接頭辞
 * @returns 画像ファイルの情報を順に返す非同期ジェネレーター
 */
async function* walk(directory: DirectoryHandle, prefix: string): AsyncGenerator<ScannedFile> {
  for await (const entry of directory.values()) {
    if (entry.name.startsWith('.')) continue
    const relativePath = prefix + entry.name
    if (entry.kind === 'directory') {
      yield* walk(entry, `${relativePath}/`)
      continue
    }
    if (!isImageFileName(entry.name)) continue
    let file: File
    try {
      file = await entry.getFile()
    } catch {
      continue
    }
    yield {
      ref: entry as unknown as FileRef,
      relativePath,
      name: entry.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
    }
  }
}

/**
 * フォルダを参照できるか判定する。
 * API は安全な接続でしか使えないため、API がなく安全な接続でもなければ、接続を理由にする。
 * @param host 判定する大域オブジェクト
 * @returns フォルダを参照できるか。できなければその理由
 */
const supportOf = (host: DirectoryPickerHost): SourceSupport => {
  if (typeof host.showDirectoryPicker === 'function') return 'supported'
  if (host.isSecureContext === false) return 'insecure-context'
  return 'unsupported-browser'
}

/**
 * File System Access API を使う PhotoSource を作る。
 * `showDirectoryPicker` がなければ非対応（`support` が `supported` 以外）として振る舞う。
 * @param host `showDirectoryPicker` を持つ大域オブジェクト。通常は `window`
 * @returns File System Access API による PhotoSource
 */
export const createFileSystemAccessSource = (host: DirectoryPickerHost): PhotoSource => {
  const picker = host.showDirectoryPicker
  const mode: PermissionMode = { mode: 'read' }
  const support = supportOf(host)

  return {
    support,

    /**
     * 読み取り専用でフォルダを選んでもらう。
     * @returns 選択結果。キャンセルや選択の制限も結果として返す
     */
    pickFolder: async () => {
      if (typeof picker !== 'function') {
        const reason = support === 'insecure-context' ? support : 'unsupported-browser'
        return { status: 'failed', message: unsupportedMessage(reason) }
      }
      try {
        const handle = await picker.call(host, { id: 'snapnest-library', mode: 'read' })
        return { status: 'picked', ref: handle as unknown as FolderRef, name: handle.name }
      } catch (error) {
        if (errorName(error) === 'AbortError') return { status: 'cancelled' }
        if (errorName(error) === 'SecurityError') {
          return {
            status: 'failed',
            message: 'このフォルダは開けません。システムのフォルダなどはブラウザが選択を制限しています。',
          }
        }
        return { status: 'failed', message: 'フォルダを開けませんでした。' }
      }
    },

    /**
     * 2 つの参照が同じフォルダを指すか調べる。参照が壊れていれば別のフォルダとみなす。
     * @param a 比較するフォルダ
     * @param b 比較するフォルダ
     * @returns 同じフォルダなら `true`
     */
    isSameFolder: async (a, b) => {
      if (!isDirectoryHandle(a) || !isDirectoryHandle(b)) return false
      try {
        return await a.isSameEntry(b)
      } catch {
        return false
      }
    },

    /**
     * 利用者に尋ねずに読み取り権限を調べる。調べられなければ権限がないとみなす。
     * @param folder 調べるフォルダ
     * @returns 権限の状態
     */
    queryPermission: async (folder) => {
      if (!isDirectoryHandle(folder) || !folder.queryPermission) return 'denied'
      try {
        return toAccessPermission(await folder.queryPermission(mode))
      } catch {
        return 'denied'
      }
    },

    /**
     * 読み取り権限を利用者に求める。求められなければ権限がないとみなす。
     * @param folder 権限を求めるフォルダ
     * @returns 求めた後の権限の状態
     */
    requestPermission: async (folder) => {
      if (!isDirectoryHandle(folder) || !folder.requestPermission) return 'denied'
      try {
        return toAccessPermission(await folder.requestPermission(mode))
      } catch {
        return 'denied'
      }
    },

    /**
     * フォルダ以下の画像ファイルを再帰的に列挙する。参照が壊れていれば例外を投げる。
     * @param folder 列挙するフォルダ
     * @returns 画像ファイルの情報を順に返す非同期ジェネレーター
     */
    scanImages: async function* (folder) {
      if (!isDirectoryHandle(folder)) throw new Error('フォルダの参照が壊れています。')
      yield* walk(folder, '')
    },

    /**
     * ファイルの内容を読む。読めない場合は例外の種類から理由を決める。
     * @param fileRef 読むファイル
     * @returns 読み込み結果
     */
    readFile: async (fileRef): Promise<ReadResult> => {
      if (!isFileHandle(fileRef)) return { ok: false, reason: 'unavailable' }
      try {
        return { ok: true, file: await fileRef.getFile() }
      } catch (error) {
        const name = errorName(error)
        if (name === 'NotFoundError') return { ok: false, reason: 'not-found' }
        if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'permission' }
        return { ok: false, reason: 'unavailable' }
      }
    },
  }
}
