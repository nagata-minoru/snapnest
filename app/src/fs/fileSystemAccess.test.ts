import { describe, expect, it, vi } from 'vitest'
import { createFileSystemAccessSource, type DirectoryPickerHost } from './fileSystemAccess'
import type { FileRef, FolderRef } from './photoSource'

/**
 * 名前付きの DOMException 相当の例外を作る。
 * @param name 例外の名前
 * @returns 例外
 */
const domError = (name: string) => Object.assign(new Error(name), { name })

/**
 * 偽のファイルハンドルを作る。
 * @param name ファイル名
 * @param getFile `getFile` の実装。省略時は中身のあるファイルを返す
 * @returns ファイルハンドル
 */
const fileHandle = (
  name: string,
  getFile = async () => new File(['abc'], name, { lastModified: 1000, type: 'image/jpeg' }),
) => ({ kind: 'file' as const, name, getFile })

type FakeFile = ReturnType<typeof fileHandle>

type FakeDirectory = {
  kind: 'directory'
  name: string
  isSameEntry: (other: unknown) => Promise<boolean>
  values: () => AsyncIterable<FakeDirectory | FakeFile>
  queryPermission: (descriptor: { mode: 'read' }) => Promise<PermissionState>
  requestPermission: (descriptor: { mode: 'read' }) => Promise<PermissionState>
}

/**
 * 偽のディレクトリハンドルを作る。
 * @param name ディレクトリ名
 * @param entries 中のファイルとディレクトリ
 * @returns ディレクトリハンドル
 */
const directoryHandle = (name: string, entries: Array<FakeDirectory | FakeFile>): FakeDirectory => {
  const handle: FakeDirectory = {
    kind: 'directory',
    name,

    /**
     * 同じハンドルか調べる。
     * @param other 比較するハンドル
     * @returns 同じハンドルなら `true`
     */
    isSameEntry: async (other) => other === handle,

    /**
     * 中のファイルとディレクトリを順に返す。
     * @returns ファイルとディレクトリを返す非同期ジェネレーター
     */
    values: async function* () {
      yield* entries
    },
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
  }
  return handle
}

/**
 * 偽のハンドルを抽象化レイヤーの参照として扱う。
 * @param handle ハンドル
 * @returns 参照
 */
const asFolderRef = (handle: unknown) => handle as FolderRef

/**
 * 非同期イテレーターをすべて読んで配列にする。
 * @param iterable 読む対象
 * @returns 読んだ値の配列
 */
const collect = async <T>(iterable: AsyncIterable<T>) => {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

/**
 * フォルダ選択の結果を返す大域オブジェクトを作る。
 * @param pick `showDirectoryPicker` の実装
 * @returns 大域オブジェクト
 */
const hostWith = (pick: () => Promise<unknown>) => ({ showDirectoryPicker: pick }) as DirectoryPickerHost

describe('createFileSystemAccessSource', () => {
  it('showDirectoryPicker がなければ非対応になる', async () => {
    const source = createFileSystemAccessSource({})

    expect(source.supported).toBe(false)
    expect(await source.pickFolder()).toEqual({
      status: 'failed', message: expect.stringContaining('対応していません'),
    })
  })

  describe('pickFolder', () => {
    it('選んだフォルダの参照と名前を返す', async () => {
      const folder = directoryHandle('Pictures', [])
      const source = createFileSystemAccessSource(hostWith(async () => folder))

      expect(await source.pickFolder()).toEqual({ status: 'picked', ref: folder, name: 'Pictures' })
    })

    it('キャンセルを結果として返す', async () => {
      const source = createFileSystemAccessSource(hostWith(async () => { throw domError('AbortError') }))

      expect(await source.pickFolder()).toEqual({ status: 'cancelled' })
    })

    it('選択を制限されたフォルダは理由を返す', async () => {
      const source = createFileSystemAccessSource(hostWith(async () => { throw domError('SecurityError') }))

      expect(await source.pickFolder()).toEqual({ status: 'failed', message: expect.stringContaining('制限') })
    })
  })

  it('画像だけを再帰的に列挙し、隠しファイルと読めないファイルを飛ばす', async () => {
    const folder = directoryHandle('Pictures', [
      fileHandle('a.JPG'),
      fileHandle('notes.txt'),
      fileHandle('._a.jpg'),
      fileHandle('broken.png', async () => { throw domError('NotFoundError') }),
      directoryHandle('.thumbnails', [fileHandle('cache.jpg')]),
      directoryHandle('2026', [directoryHandle('10', [fileHandle('b.webp')])]),
    ])
    const source = createFileSystemAccessSource({})

    const files = await collect(source.scanImages(asFolderRef(folder)))

    expect(files.map((file) => file.relativePath)).toEqual(['a.JPG', '2026/10/b.webp'])
    expect(files[0]).toMatchObject({ name: 'a.JPG', size: 3, lastModified: 1000, type: 'image/jpeg' })
  })

  it('壊れた参照を列挙しようとすると例外になる', async () => {
    const source = createFileSystemAccessSource({})

    await expect(collect(source.scanImages(asFolderRef({ kind: 'directory' })))).rejects.toThrow('壊れています')
  })

  describe('readFile', () => {
    it.each([
      ['NotFoundError', 'not-found'],
      ['NotAllowedError', 'permission'],
      ['SecurityError', 'permission'],
      ['UnknownError', 'unavailable'],
    ])('%s を %s として返す', async (errorName, reason) => {
      const handle = fileHandle('a.jpg', async () => { throw domError(errorName) })
      const source = createFileSystemAccessSource({})

      expect(await source.readFile(handle as unknown as FileRef)).toEqual({ ok: false, reason })
    })

    it('壊れた参照は読めないものとして返す', async () => {
      const source = createFileSystemAccessSource({})

      expect(await source.readFile({} as FileRef)).toEqual({ ok: false, reason: 'unavailable' })
    })
  })

  describe('権限', () => {
    it('読み取り権限を問い合わせ、ブラウザの状態を変換する', async () => {
      const folder = directoryHandle('Pictures', [])
      folder.queryPermission = vi.fn(async () => 'prompt' as PermissionState)
      folder.requestPermission = vi.fn(async () => 'denied' as PermissionState)
      const source = createFileSystemAccessSource({})

      expect(await source.queryPermission(asFolderRef(folder))).toBe('prompt')
      expect(await source.requestPermission(asFolderRef(folder))).toBe('denied')
      expect(folder.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('問い合わせに失敗したら権限がないものとする', async () => {
      const folder = directoryHandle('Pictures', [])
      folder.queryPermission = vi.fn(async () => { throw domError('InvalidStateError') })
      const source = createFileSystemAccessSource({})

      expect(await source.queryPermission(asFolderRef(folder))).toBe('denied')
      expect(await source.queryPermission(asFolderRef(null))).toBe('denied')
    })
  })

  it('同じフォルダかどうかを isSameEntry で判定する', async () => {
    const a = directoryHandle('A', [])
    const b = directoryHandle('B', [])
    const source = createFileSystemAccessSource({})

    expect(await source.isSameFolder(asFolderRef(a), asFolderRef(a))).toBe(true)
    expect(await source.isSameFolder(asFolderRef(a), asFolderRef(b))).toBe(false)
    expect(await source.isSameFolder(asFolderRef(a), asFolderRef({}))).toBe(false)
  })
})
