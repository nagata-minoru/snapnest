import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { DB_NAME, openLibraryStore, type LibraryStore } from './db/libraryStore'
import { createUnsupportedSource, type PhotoSource } from './fs/photoSource'
import { createMemorySource } from './test/memorySource'

/**
 * 2026年10月の指定日の正午（UTC）を返す。どのタイムゾーンでも日付がずれないようにする。
 * @param day 日
 * @returns 日時（ミリ秒）
 */
const october = (day: number) => Date.UTC(2026, 9, day, 12)

/**
 * 写真の入ったテスト用フォルダを用意する。
 * @returns メモリ上の PhotoSource
 */
const createPicturesSource = () => {
  const memory = createMemorySource()
  memory.createFolder('pictures', 'Pictures', {
    'morning.jpg': { lastModified: october(18) },
    'trip/station.png': { lastModified: october(14), type: 'image/png' },
    'window.webp': { lastModified: october(16), type: 'image/webp' },
    'notes.txt': { lastModified: october(17) },
    '.hidden.jpg': { lastModified: october(19) },
    '.thumbnails/cache.jpg': { lastModified: october(19) },
  })
  return memory
}

/**
 * App を描画し、操作用の userEvent と画面の状態を読む関数を用意する。
 * @param source ファイルアクセスの抽象化レイヤー
 * @param openStore メタデータの保存先を開く関数
 * @returns `user`、`photoTitles`、`inspectorTitle`、`unmount` をまとめたオブジェクト
 */
const setup = async (source: PhotoSource, openStore: () => Promise<LibraryStore> = () => openLibraryStore()) => {
  const user = userEvent.setup()
  const { container, unmount } = render(<App source={source} openStore={openStore} />)
  await waitFor(() => expect(screen.queryByText('ライブラリを読み込み中…')).not.toBeInTheDocument())
  /**
   * 写真一覧に表示中の写真のタイトルを取得する。
   * @returns 表示順に並べたタイトルの配列
   */
  const photoTitles = () => (
    Array.from(container.querySelectorAll('.photo-card strong'), (element) => element.textContent)
  )
  /**
   * 詳細表示に出ている写真のタイトルを取得する。
   * @returns 写真のタイトル。詳細表示が空のときは `undefined`
   */
  const inspectorTitle = () => container.querySelector('.inspector h2')?.textContent
  return { user, photoTitles, inspectorTitle, unmount, container }
}

/**
 * フォルダを開くボタンを押し、読み込み完了の通知を待つ。
 * @param user 操作用の userEvent
 */
const openFolder = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole('button', { name: /フォルダを開く/ })[0])
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/枚の写真を読み込みました/))
}

/**
 * サイドバーのナビゲーションを取得する。
 * @returns ナビゲーションの要素
 */
const nav = () => screen.getByRole('navigation')

describe('App', () => {
  it('初回はフォルダを開く案内を表示する', async () => {
    const { photoTitles } = await setup(createPicturesSource().source)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('すべての写真')
    expect(screen.getByRole('heading', { name: '写真のフォルダを開きましょう' })).toBeInTheDocument()
    expect(photoTitles()).toHaveLength(0)
    expect(screen.getByText(/サイトデータを削除/)).toBeInTheDocument()
  })

  describe('フォルダを開く', () => {
    it('画像だけを新しい順に一覧し、先頭の写真の詳細を表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles, inspectorTitle } = await setup(memory.source)

      await openFolder(user)

      expect(screen.getByRole('status')).toHaveTextContent('3 枚の写真を読み込みました。')
      expect(photoTitles()).toEqual(['morning.jpg', 'window.webp', 'station.png'])
      expect(screen.getByText('3 枚')).toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: /^Pictures/ })).toHaveTextContent('3')
      expect(inspectorTitle()).toBe('morning.jpg')
      await waitFor(() => expect(document.querySelectorAll('.photo-card img')).toHaveLength(3))
    })

    it('キャンセルしたら何も変えない', async () => {
      const memory = createPicturesSource()
      memory.queuePick('cancel')
      const { user, photoTitles } = await setup(memory.source)

      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await user.click(screen.getAllByRole('button', { name: /フォルダを開く/ })[0])

      expect(photoTitles()).toHaveLength(0)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('開けなかったら理由を通知する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('fail')
      const { user } = await setup(memory.source)

      await user.click(screen.getAllByRole('button', { name: /フォルダを開く/ })[0])

      expect(await screen.findByRole('status')).toHaveTextContent('フォルダを開けませんでした。')
    })

    it('同じフォルダをもう一度開いても重複させず、読み込み直す', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)

      await openFolder(user)
      memory.folder('pictures').files.set('new.jpg', { lastModified: october(20) })
      await user.click(screen.getByRole('button', { name: '通知を閉じる' }))
      await openFolder(user)

      expect(within(nav()).getAllByRole('button', { name: /^Pictures/ })).toHaveLength(1)
      expect(photoTitles()).toEqual(['new.jpg', 'morning.jpg', 'window.webp', 'station.png'])
    })

    it('非対応ブラウザでは案内を表示する', async () => {
      const { user } = await setup(createUnsupportedSource())

      expect(screen.getByRole('alert')).toHaveTextContent('このブラウザはフォルダの参照に対応していません。')

      await user.click(screen.getAllByRole('button', { name: /フォルダを開く/ })[0])

      expect(screen.getByRole('status')).toHaveTextContent('Chrome で開いてください。')
    })

    it('読み込みが途中で失敗したら、見つかった分だけ残して通知する', async () => {
      const memory = createPicturesSource()
      memory.folder('pictures').failScanAfter = 1
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)

      await user.click(screen.getAllByRole('button', { name: /フォルダを開く/ })[0])

      expect(await screen.findByRole('status')).toHaveTextContent('読み込みが途中で止まりました（1 枚まで）')
      expect(photoTitles()).toHaveLength(0)
      expect(within(nav()).getByRole('button', { name: /^Pictures/ })).toBeInTheDocument()
    })
  })

  describe('保存と再起動', () => {
    it('開き直すと保存済みの写真を表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      first.unmount()

      const { photoTitles } = await setup(memory.source)

      expect(photoTitles()).toEqual(['morning.jpg', 'window.webp', 'station.png'])
    })

    it('権限がなければ再許可を求め、許可されたら写真を表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      first.unmount()
      memory.folder('pictures').permission = 'prompt'

      const { user, container } = await setup(memory.source)

      expect(screen.getByText(/「Pictures」へのアクセス許可が必要です/)).toBeInTheDocument()
      expect(container.querySelectorAll('.photo-card .thumbnail-state')).toHaveLength(3)
      expect(container.querySelector('.photo-card img')).toBeNull()

      await user.click(screen.getAllByRole('button', { name: 'アクセスを許可' })[0])

      await waitFor(() => expect(container.querySelectorAll('.photo-card img')).toHaveLength(3))
      expect(screen.queryByText(/アクセス許可が必要です/)).not.toBeInTheDocument()
    })

    it('再許可を拒否されたら、写真を読まずに案内を続ける', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      first.unmount()
      memory.folder('pictures').permission = 'prompt'
      memory.folder('pictures').requestResult = 'denied'

      const { user, container } = await setup(memory.source)
      await user.click(screen.getAllByRole('button', { name: 'アクセスを許可' })[0])

      expect(await screen.findByRole('status')).toHaveTextContent('アクセスが許可されませんでした')
      expect(screen.getByText(/アクセスが拒否されています/)).toBeInTheDocument()
      expect(container.querySelector('.photo-card img')).toBeNull()
    })

    it('壊れた保存データは読み飛ばし、残りを表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      first.unmount()
      const db = await openDB(DB_NAME)
      await db.put('photos', { id: 'broken', folderId: 'x' })
      await db.put('folders', { id: 'broken-folder' })
      db.close()

      const { photoTitles } = await setup(memory.source)

      expect(photoTitles()).toHaveLength(3)
      expect(screen.getByRole('status')).toHaveTextContent('壊れた保存データが 2 件あった')
    })

    it('保存領域を開けなくても使え、保存されないことを伝える', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source, () => Promise.reject(new Error('開けない')))

      expect(screen.getByRole('status')).toHaveTextContent('このページを閉じると登録内容は失われます。')
      expect(screen.getByText('登録内容は保存されません')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '通知を閉じる' }))
      await openFolder(user)

      expect(photoTitles()).toHaveLength(3)
    })
  })

  describe('参照切れ', () => {
    it('表示しようとしたファイルがなければ「再接続が必要」に入れる', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      first.unmount()
      memory.folder('pictures').files.delete('window.webp')

      const { user, photoTitles, container } = await setup(memory.source)

      await waitFor(() => expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent('1'))
      expect(container.querySelectorAll('.photo-card .thumbnail-state')).toHaveLength(1)

      await user.click(within(nav()).getByRole('button', { name: /再接続が必要/ }))

      expect(photoTitles()).toEqual(['window.webp'])
      expect(screen.getByText(/ファイルが見つかりません/)).toBeInTheDocument()
    })

    it('再読み込みで消えたファイルを参照切れにし、戻れば元に戻す', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user } = await setup(memory.source)
      await openFolder(user)
      const removed = memory.folder('pictures').files.get('morning.jpg')!
      memory.folder('pictures').files.delete('morning.jpg')

      await user.click(within(nav()).getByRole('button', { name: /^Pictures/ }))
      await user.click(screen.getByRole('button', { name: /^↻ 再読み込み/ }))

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
        '2 枚の写真を読み込みました。1 枚が見つからなくなりました。',
      ))
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent('1')

      memory.folder('pictures').files.set('morning.jpg', removed)
      await user.click(screen.getByRole('button', { name: /^↻ 再読み込み/ }))

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 枚の写真を読み込みました。'))
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent('0')
    })
  })

  it('写真を選ぶと詳細表示が切り替わる', async () => {
    const memory = createPicturesSource()
    memory.queuePick('pictures')
    const { user, inspectorTitle } = await setup(memory.source)
    await openFolder(user)

    await user.click(screen.getByRole('button', { name: /station\.png/ }))

    expect(inspectorTitle()).toBe('station.png')
    expect(screen.getByRole('button', { name: /station\.png/ })).toHaveClass('selected')
    expect(screen.getByText('Pictures / trip')).toBeInTheDocument()
    expect(screen.getByText(/^PNG ·/)).toBeInTheDocument()
  })
})
