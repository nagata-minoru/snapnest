import type { AccessPermission, FileRef, FolderRef, PhotoSource, PickResult } from '../fs/photoSource'
import { isImageFileName } from '../fs/photoSource'

/** テスト用のファイル */
export type MemoryFile = { lastModified: number; content?: string; type?: string }

type MemoryFolder = {
  name: string
  files: Map<string, MemoryFile>
  permission: AccessPermission
  /** `requestPermission` で返す権限。省略時は `granted` */
  requestResult: AccessPermission
  /** 指定した数のファイルを返した後に読み込みを失敗させる */
  failScanAfter: number | null
}

type MemoryFolderRef = { kind: 'memory-folder'; folderKey: string }
type MemoryFileRef = { kind: 'memory-file'; folderKey: string; path: string }

/**
 * テスト用に、メモリ上のフォルダを扱う PhotoSource を作る。
 * 参照は構造化複製できる普通のオブジェクトなので、IndexedDB にも保存できる。
 * @returns PhotoSource と、フォルダの状態を操作する関数
 */
export const createMemorySource = () => {
  const folders = new Map<string, MemoryFolder>()
  const picks: Array<string | 'cancel' | 'fail'> = []

  /**
   * 参照からフォルダを取り出す。
   * @param ref フォルダの参照
   * @returns フォルダ。見つからなければ `undefined`
   */
  const folderOf = (ref: FolderRef | FileRef) => folders.get((ref as unknown as MemoryFolderRef).folderKey)

  /**
   * フォルダの参照を作る。
   * @param folderKey フォルダのキー
   * @returns フォルダの参照
   */
  const folderRef = (folderKey: string) => (
    ({ kind: 'memory-folder', folderKey } satisfies MemoryFolderRef) as unknown as FolderRef
  )

  const source: PhotoSource = {
    support: 'supported',

    /**
     * 予約しておいた結果でフォルダを選ぶ。選ばれたフォルダには権限を与える。
     * @returns 選択結果。予約がなければキャンセル
     */
    pickFolder: async (): Promise<PickResult> => {
      const next = picks.shift() ?? 'cancel'
      if (next === 'cancel') return { status: 'cancelled' }
      if (next === 'fail') return { status: 'failed', message: 'フォルダを開けませんでした。' }
      const folder = folders.get(next)
      if (!folder) throw new Error(`未登録のフォルダ: ${next}`)
      folder.permission = 'granted'
      return { status: 'picked', ref: folderRef(next), name: folder.name }
    },

    /**
     * 2 つの参照が同じフォルダを指すか、フォルダのキーで調べる。
     * @param a 比較するフォルダ
     * @param b 比較するフォルダ
     * @returns 同じフォルダなら `true`
     */
    isSameFolder: async (a, b) => {
      return (a as unknown as MemoryFolderRef).folderKey === (b as unknown as MemoryFolderRef).folderKey
    },

    /**
     * フォルダの権限を返す。
     * @param ref 調べるフォルダ
     * @returns 権限の状態。フォルダがなければ `denied`
     */
    queryPermission: async (ref) => folderOf(ref)?.permission ?? 'denied',

    /**
     * フォルダの権限を、あらかじめ決めた結果に変える。
     * @param ref 権限を求めるフォルダ
     * @returns 求めた後の権限の状態。フォルダがなければ `denied`
     */
    requestPermission: async (ref) => {
      const folder = folderOf(ref)
      if (!folder) return 'denied'
      folder.permission = folder.requestResult
      return folder.permission
    },

    /**
     * フォルダ内の画像ファイルを列挙する。`failScanAfter` の数を返した後は例外を投げる。
     * @param ref 列挙するフォルダ
     * @returns 画像ファイルの情報を順に返す非同期ジェネレーター
     */
    scanImages: async function* (ref) {
      const folder = folderOf(ref)
      if (!folder || folder.permission !== 'granted') throw new Error('読み込めません')
      const folderKey = (ref as unknown as MemoryFolderRef).folderKey
      let count = 0
      for (const [path, file] of folder.files) {
        const segments = path.split('/')
        if (segments.some((segment) => segment.startsWith('.')) || !isImageFileName(segments.at(-1) ?? '')) continue
        if (folder.failScanAfter !== null && count >= folder.failScanAfter) throw new Error('読み込み中に失敗')
        count += 1
        const content = file.content ?? 'image'
        yield {
          ref: ({ kind: 'memory-file', folderKey, path } satisfies MemoryFileRef) as unknown as FileRef,
          relativePath: path,
          name: path.split('/').at(-1) ?? path,
          size: content.length,
          lastModified: file.lastModified,
          type: file.type ?? 'image/jpeg',
        }
      }
    },

    /**
     * ファイルの内容を読む。
     * @param ref 読むファイル
     * @returns 読み込み結果。権限がなければ `permission`、ファイルがなければ `not-found`
     */
    readFile: async (ref) => {
      const { path } = ref as unknown as MemoryFileRef
      const folder = folderOf(ref)
      if (!folder || folder.permission !== 'granted') return { ok: false, reason: 'permission' }
      const file = folder.files.get(path)
      if (!file) return { ok: false, reason: 'not-found' }
      return {
        ok: true,
        file: new File([file.content ?? 'image'], path, {
          type: file.type ?? 'image/jpeg', lastModified: file.lastModified,
        }),
      }
    },
  }

  return {
    source,

    /**
     * フォルダを用意する。
     * @param folderKey フォルダのキー
     * @param name フォルダ名
     * @param files 相対パスをキーにしたファイル
     */
    createFolder: (folderKey: string, name: string, files: Record<string, MemoryFile>) => {
      folders.set(folderKey, {
        name,
        files: new Map(Object.entries(files)),
        permission: 'prompt',
        requestResult: 'granted',
        failScanAfter: null,
      })
    },

    /**
     * 次のフォルダ選択の結果を予約する。
     * @param result 選ばれるフォルダのキー、またはキャンセル・失敗
     */
    queuePick: (result: string | 'cancel' | 'fail') => {
      picks.push(result)
    },

    /**
     * フォルダを取り出す。テストの中で状態を書き換えるために使う。
     * @param folderKey フォルダのキー
     * @returns フォルダ
     */
    folder: (folderKey: string) => {
      const folder = folders.get(folderKey)
      if (!folder) throw new Error(`未登録のフォルダ: ${folderKey}`)
      return folder
    },
  }
}
