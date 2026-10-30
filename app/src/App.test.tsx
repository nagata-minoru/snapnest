import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { openDB } from 'idb'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { DB_NAME, openLibraryStore, type LibraryStore, type OpenLibraryStore } from './db/libraryStore'
import { createUnsupportedSource, type PhotoSource } from './fs/photoSource'
import { createMemorySource } from './test/memorySource'
import { stubStorage } from './test/storage'
import type { ThumbnailMaker } from './thumbnails/thumbnailMaker'

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
 * @param makeThumbnail 原本からサムネイルを作る関数。省略するとサムネイルを作らない
 * @returns `user`、`photoTitles`、`inspectorTitle`、`unmount` をまとめたオブジェクト
 */
const setup = async (
  source: PhotoSource,
  openStore: () => Promise<LibraryStore> = () => openLibraryStore(),
  makeThumbnail?: ThumbnailMaker,
) => {
  const user = userEvent.setup()
  const { container, unmount } = render(
    <App source={source} openStore={openStore} makeThumbnail={makeThumbnail} />,
  )
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

    it('更新日時も相対パスも同じ写真は、開き直してもフォルダ名順に並べる', async () => {
      const memory = createMemorySource()
      memory.createFolder('zoo', 'Zoo', { 'same.jpg': { lastModified: october(18) } })
      memory.createFolder('archive', 'Archive', { 'same.jpg': { lastModified: october(18) } })
      memory.queuePick('zoo')
      memory.queuePick('archive')
      const first = await setup(memory.source)
      await openFolder(first.user)
      await first.user.click(screen.getByRole('button', { name: '通知を閉じる' }))
      await openFolder(first.user)

      /**
       * 一覧の先頭の写真を選び、詳細表示に出た保存場所を返す。
       * @param user 操作用の userEvent
       * @returns 保存場所の文
       */
      const firstLocation = async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getAllByRole('button', { name: /same\.jpg/ })[0])
        return screen.getByRole('complementary', { name: '写真の詳細' }).querySelector('strong')?.textContent
      }
      expect(await firstLocation(first.user)).toBe('Archive')
      first.unmount()
      const second = await setup(memory.source)
      expect(await firstLocation(second.user)).toBe('Archive')
    })

    it('非対応ブラウザでは案内を表示し、フォルダを開くボタンを押せなくする', async () => {
      await setup(createUnsupportedSource())

      expect(screen.getByRole('alert')).toHaveTextContent('このブラウザはフォルダの参照に対応していません。')
      expect(screen.getByRole('alert')).toHaveTextContent('パソコン版の Chrome で開いてください。')
      expect(screen.getByRole('heading', { name: 'このブラウザではフォルダを開けません' })).toBeInTheDocument()
      const buttons = screen.getAllByRole('button', { name: /フォルダを開く/ })
      expect(buttons).toHaveLength(1)
      expect(buttons[0]).toBeDisabled()
    })

    it('安全でない接続で開いたときは、https か localhost で開くよう案内する', async () => {
      await setup(createUnsupportedSource('insecure-context'))

      expect(screen.getByRole('alert')).toHaveTextContent('安全な接続で開かれていないため')
      expect(screen.getByRole('alert')).toHaveTextContent('http://localhost で開いてください。')
      expect(screen.getByRole('heading', { name: 'このアドレスではフォルダを開けません' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /フォルダを開く/ })).toBeDisabled()
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
    it('古い版のタブが残っていれば待っていることを伝え、閉じられたら読み込む', async () => {
      let open = () => {}
      /**
       * 待たされたことを伝え、`open` が呼ばれるまで開くのを待つ。
       * @param events 保存先の出来事を受け取る関数
       * @returns 開いたライブラリ
       */
      const openStore: OpenLibraryStore = async (events) => {
        events?.onBlocked?.()
        await new Promise<void>((resolve) => {
          open = resolve
        })
        return openLibraryStore()
      }
      render(<App source={createPicturesSource().source} openStore={openStore} />)

      expect(await screen.findByRole('heading', { name: 'ほかのタブの snapnest を待っています' })).toBeInTheDocument()
      act(() => open())

      expect(await screen.findByRole('heading', { name: '写真のフォルダを開きましょう' })).toBeInTheDocument()
      expect(screen.queryByText(/ほかのタブの snapnest/)).not.toBeInTheDocument()
    })

    it('別のタブが新しい版で開いて接続が閉じたら、保存できないことと再読み込みを伝える', async () => {
      let closed = () => {}
      /**
       * 接続が閉じたときに呼ぶ関数を覚えておき、ライブラリを開く。
       * @param events 保存先の出来事を受け取る関数
       * @returns 開いたライブラリ
       */
      const openStore: OpenLibraryStore = async (events) => {
        closed = () => events?.onClosed?.()
        return openLibraryStore()
      }
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source, openStore)
      await openFolder(user)

      act(() => closed())

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('写真の情報を保存できなくなりました。')
      expect(within(alert).getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
      expect(screen.getByText('登録内容は保存されません')).toBeInTheDocument()
      expect(photoTitles()).toEqual(['morning.jpg', 'window.webp', 'station.png'])
    })

    it('ブラウザが保存領域の保持を約束していなければ、容量不足で消えることがあると伝える', async () => {
      await setup(createPicturesSource().source)

      expect(screen.getByText(/空き容量が少なくなったときも/)).toBeInTheDocument()
    })

    it('ブラウザが保存領域の保持を約束していれば、容量不足の注意を出さない', async () => {
      stubStorage({ persisted: async () => true })
      await setup(createPicturesSource().source)

      await waitFor(() => expect(screen.queryByText(/空き容量が少なくなったときも/)).not.toBeInTheDocument())
      expect(screen.getByText(/サイトデータを削除/)).toBeInTheDocument()
    })

    it('フォルダを開くと保存領域の保持を頼み、認められたら容量不足の注意を消す', async () => {
      const persist = vi.fn(async () => true)
      stubStorage({ persisted: async () => false, persist })
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user } = await setup(memory.source)
      expect(screen.getByText(/空き容量が少なくなったときも/)).toBeInTheDocument()

      await openFolder(user)

      expect(persist).toHaveBeenCalled()
      expect(screen.queryByText(/空き容量が少なくなったときも/)).not.toBeInTheDocument()
    })

    it('保存領域の保持が認められなければ、容量不足の注意を出したままにする', async () => {
      stubStorage({ persisted: async () => false, persist: async () => false })
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user } = await setup(memory.source)

      await openFolder(user)

      expect(screen.getByText(/空き容量が少なくなったときも/)).toBeInTheDocument()
    })

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

    it('新しい版がデータベースのバージョンを上げていたら、古い版では読めないことを伝える', async () => {
      const memory = createPicturesSource()
      await setup(memory.source, () => Promise.reject(new DOMException('新しい版', 'VersionError')))

      expect(screen.getByRole('status')).toHaveTextContent(
        '保存済みの写真の情報は新しい版の snapnest で更新されたため、この古い版では読めません。',
      )
      expect(screen.getByText('登録内容は保存されません')).toBeInTheDocument()
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

  describe('再接続', () => {
    /**
     * Pictures を開き、station.png を Trip に入れてから、別の場所へ移して再読み込みする。
     * @param movedTo 移動先の相対パス
     * @returns setup の戻り値と、テスト用のフォルダ
     */
    const moveStation = async (...movedTo: string[]) => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const app = await setup(memory.source)
      await openFolder(app.user)
      await app.user.click(screen.getByRole('button', { name: 'コレクションを作る' }))
      await app.user.type(screen.getByRole('textbox', { name: 'コレクション名' }), 'Trip')
      await app.user.click(screen.getByRole('button', { name: '作成' }))
      await app.user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await app.user.click(screen.getByRole('button', { name: /station\.png/ }))
      await app.user.click(within(inspector()).getByRole('button', { name: '＋ 追加' }))
      await app.user.click(within(inspector()).getByRole('button', { name: 'Trip' }))

      const files = memory.folder('pictures').files
      const station = files.get('trip/station.png')!
      files.delete('trip/station.png')
      for (const path of movedTo) files.set(path, station)
      await app.user.click(within(nav()).getByRole('button', { name: /^Pictures/ }))
      await app.user.click(screen.getByRole('button', { name: /^↻ 再読み込み/ }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 枚が見つからなくなりました。'))
      await app.user.click(within(nav()).getByRole('button', { name: /再接続が必要/ }))
      return { ...app, memory }
    }

    /**
     * 詳細表示を取得する。
     * @returns 詳細表示の要素
     */
    const inspector = () => screen.getByRole('complementary', { name: '写真の詳細' })

    /**
     * 再接続の候補の一覧を取得する。
     * @returns 候補の一覧の要素
     */
    const candidateList = () => within(inspector()).getByRole('list', { name: '再接続の候補' })

    it('移動したファイルを候補に出し、確かめてからつなぎ直すとコレクションを引き継ぐ', async () => {
      const { user, photoTitles, inspectorTitle } = await moveStation('2026/station.png')
      const moved = 'Pictures / 2026 / station.png'

      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent('候補あり')
      expect(screen.getByText(/1 枚に再接続の候補があります/)).toBeInTheDocument()
      expect(photoTitles()).toEqual(['station.png'])
      expect(inspectorTitle()).toBe('station.png')
      expect(within(candidateList()).getByText(moved)).toBeInTheDocument()
      expect(within(candidateList()).getByText('名前・サイズ・更新日時が一致')).toBeInTheDocument()

      await user.click(within(candidateList()).getByRole('button', { name: `「${moved}」につなぐ` }))
      await user.click(within(within(inspector()).getByRole('alert')).getByRole('button', { name: 'やめる' }))
      expect(within(inspector()).queryByRole('alert')).not.toBeInTheDocument()

      await user.click(within(candidateList()).getByRole('button', { name: `「${moved}」につなぐ` }))
      await user.click(within(inspector()).getByRole('button', { name: 'つなぎ直す' }))

      expect(await screen.findByRole('status')).toHaveTextContent(
        '「Pictures / trip / station.png」を「Pictures / 2026 / station.png」につなぎ直しました。',
      )
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent(/^⌁再接続が必要0$/)
      expect(screen.getByText('再接続が必要な写真はありません')).toBeInTheDocument()

      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))
      expect(photoTitles()).toEqual(['station.png'])
      expect(within(inspector()).getByText('Pictures / 2026')).toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: /すべての写真/ })).toHaveTextContent(/3$/)
    })

    it('つなぎ直した結果は開き直しても残る', async () => {
      const { user, unmount, memory } = await moveStation('2026/station.png')
      await user.click(within(candidateList()).getByRole('button', { name: /につなぐ$/ }))
      await user.click(within(inspector()).getByRole('button', { name: 'つなぎ直す' }))
      await screen.findByText(/につなぎ直しました/)
      unmount()

      const reopened = await setup(memory.source)
      await reopened.user.click(within(nav()).getByRole('button', { name: /Trip/ }))

      expect(reopened.photoTitles()).toEqual(['station.png'])
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent(/0$/)
    })

    it('候補が複数あれば、自動では選ばずに見比べるよう伝える', async () => {
      const { user } = await moveStation('2026/station.png', 'backup/station.png')

      expect(within(inspector()).getByText(/^候補が複数あります。/)).toBeInTheDocument()
      expect(within(candidateList()).getAllByRole('listitem')).toHaveLength(2)
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent(/1$/)

      await user.click(within(candidateList()).getByRole('button', { name: /「Pictures \/ backup \/ station\.png」/ }))
      await user.click(within(inspector()).getByRole('button', { name: 'つなぎ直す' }))

      expect(await screen.findByRole('status')).toHaveTextContent(
        '「Pictures / trip / station.png」を「Pictures / backup / station.png」につなぎ直しました。',
      )
      expect(within(nav()).getByRole('button', { name: /すべての写真/ })).toHaveTextContent(/4$/)
    })

    it('一覧に見えている写真へつなぎ直したら、その写真を選んだままにする', async () => {
      const { user, inspectorTitle } = await moveStation('2026/station.png')
      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      const missingCard = screen.getAllByRole('button', { name: /station\.png/ })
        .find((card) => within(card).queryByText('見つかりません'))
      await user.click(missingCard!)
      expect(within(inspector()).getByText('Pictures / trip')).toBeInTheDocument()

      await user.click(within(candidateList()).getByRole('button', { name: /につなぐ$/ }))
      await user.click(within(inspector()).getByRole('button', { name: 'つなぎ直す' }))
      await screen.findByText(/につなぎ直しました/)

      expect(inspectorTitle()).toBe('station.png')
      expect(within(inspector()).getByText('Pictures / 2026')).toBeInTheDocument()
    })

    it('候補がなければ探し方を案内し、確かめてからライブラリから外せる', async () => {
      const { user, photoTitles } = await moveStation()

      expect(within(inspector()).getByText(/候補は見つかりませんでした/)).toBeInTheDocument()
      expect(within(inspector()).getByText(/元のファイルが見つかるまで原本を開けません/)).toBeInTheDocument()
      expect(within(inspector()).queryByText(/端末内にあります/)).not.toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).not.toHaveTextContent('候補あり')

      await user.click(within(inspector()).getByRole('button', { name: 'ライブラリから外す' }))
      expect(within(inspector()).getByRole('alert')).toHaveTextContent('写真の原本には触れません。')
      await user.click(within(inspector()).getByRole('button', { name: '外す' }))

      expect(await screen.findByRole('status')).toHaveTextContent('「station.png」をライブラリから外しました。')
      expect(photoTitles()).toEqual([])
      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))
      expect(within(nav()).getByRole('button', { name: /Trip/ })).toHaveTextContent(/0$/)
      expect(within(nav()).getByRole('button', { name: /すべての写真/ })).toHaveTextContent(/2$/)
    })
  })

  describe('サムネイル', () => {
    /**
     * ファイル名を内容に入れたサムネイルを作る ThumbnailMaker のモックを作る。
     * @returns ThumbnailMaker のモック
     */
    const createMaker = () => vi.fn<ThumbnailMaker>(async (file) => (
      new Blob([`thumbnail:${file.name}`], { type: 'image/webp' })
    ))

    /**
     * 作ったサムネイルの元になった原本のファイル名を取得する。
     * @param maker ThumbnailMaker のモック
     * @returns ファイル名の配列（順不同のため並べ替える）
     */
    const madeFrom = (maker: ReturnType<typeof createMaker>) => maker.mock.calls.map(([file]) => file.name).sort()

    /**
     * 一覧に表示しているサムネイルの画像の数を数える。
     * @param container 描画先の要素
     * @returns 画像の数
     */
    const cardImages = (container: HTMLElement) => container.querySelectorAll('.photo-card img').length

    /**
     * フォルダを開いてサムネイルを作り、保存し終えたら画面を閉じる。
     * @param memory メモリ上のフォルダ
     * @returns 最初の画面で使った ThumbnailMaker のモック
     */
    const cacheThumbnails = async (memory: ReturnType<typeof createPicturesSource>) => {
      const maker = createMaker()
      memory.queuePick('pictures')
      const first = await setup(memory.source, undefined, maker)
      await openFolder(first.user)
      await waitFor(() => expect(cardImages(first.container)).toBe(3))
      await waitFor(async () => {
        const db = await openDB(DB_NAME)
        const count = await db.count('thumbnails')
        db.close()
        expect(count).toBe(3)
      })
      first.unmount()
      return maker
    }

    it('サムネイルを作って一覧に表示し、保存する', async () => {
      const memory = createPicturesSource()

      const maker = await cacheThumbnails(memory)

      expect(madeFrom(maker)).toEqual(['morning.jpg', 'trip/station.png', 'window.webp'])
      const shown = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob)
      const thumbnails = shown.filter((blob): blob is Blob => blob instanceof Blob && !(blob instanceof File))
      expect(thumbnails.map((blob) => blob.type)).toEqual(Array(3).fill('image/webp'))
    })

    it('開き直すと保存済みのサムネイルを使い、作り直さない', async () => {
      const memory = createPicturesSource()
      await cacheThumbnails(memory)
      const maker = createMaker()

      const { container } = await setup(memory.source, undefined, maker)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      expect(maker).not.toHaveBeenCalled()
    })

    it('原本が変わっていたら作り直す', async () => {
      const memory = createPicturesSource()
      await cacheThumbnails(memory)
      memory.folder('pictures').files.set('morning.jpg', { lastModified: october(20), content: 'edited' })
      const maker = createMaker()

      const { container } = await setup(memory.source, undefined, maker)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      expect(madeFrom(maker)).toEqual(['morning.jpg'])
    })

    it('壊れた保存済みのサムネイルは作り直す', async () => {
      const memory = createPicturesSource()
      await cacheThumbnails(memory)
      const db = await openDB(DB_NAME)
      const photos = await db.getAll('photos') as Array<{ id: string; relativePath: string }>
      const morning = photos.find((photo) => photo.relativePath === 'morning.jpg')!
      await db.put('thumbnails', { photoId: morning.id, bytes: 'broken' })
      db.close()
      const maker = createMaker()

      const { container } = await setup(memory.source, undefined, maker)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      expect(madeFrom(maker)).toEqual(['morning.jpg'])
    })

    it('アクセス許可がなくても、保存済みのサムネイルを表示する', async () => {
      const memory = createPicturesSource()
      await cacheThumbnails(memory)
      memory.folder('pictures').permission = 'prompt'
      const maker = createMaker()

      const { container } = await setup(memory.source, undefined, maker)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      const badges = container.querySelectorAll('.photo-card .thumbnail-state.badge')
      expect(Array.from(badges, (badge) => badge.textContent)).toEqual(Array(3).fill('アクセス許可が必要'))
      expect(maker).not.toHaveBeenCalled()
      await waitFor(() => expect(container.querySelector('.inspector img')).not.toBeNull())
      expect(container.querySelector('.inspector .thumbnail-state.badge')).toHaveTextContent('アクセス許可が必要')
    })

    it('ファイルが見つからなくなっても、保存済みのサムネイルを表示する', async () => {
      const memory = createPicturesSource()
      await cacheThumbnails(memory)
      memory.folder('pictures').files.delete('window.webp')

      const { user, container } = await setup(memory.source, undefined, createMaker())

      await waitFor(() => expect(within(nav()).getByRole('button', { name: /再接続が必要/ })).toHaveTextContent('1'))
      const card = screen.getByRole('button', { name: /window\.webp/ })
      await waitFor(() => expect(card.querySelector('img')).not.toBeNull())
      expect(card.querySelector('.thumbnail-state.badge')).toHaveTextContent('見つかりません')

      await user.click(card)

      await waitFor(() => expect(container.querySelector('.inspector img')).not.toBeNull())
      expect(container.querySelector('.inspector .thumbnail-state.badge')).toHaveTextContent('見つかりません')
      expect(within(container.querySelector('.inspector')!).getByText('サイズ').nextSibling).toHaveTextContent('—')
    })

    it('サムネイルを作れなければ原本を表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const maker = vi.fn<ThumbnailMaker>().mockResolvedValue(null).mockRejectedValueOnce(new Error('壊れた画像'))
      const { user, container } = await setup(memory.source, undefined, maker)

      await openFolder(user)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      expect(maker).toHaveBeenCalledTimes(3)
      const shown = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob)
      expect(shown.every((blob) => blob instanceof File)).toBe(true)
      const db = await openDB(DB_NAME)
      expect(await db.count('thumbnails')).toBe(0)
      db.close()
    })

    it('サムネイルを保存できなくても表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      /**
       * サムネイルの保存だけが失敗する保存先を開く。
       * @returns 保存先
       */
      const openStore = async (): Promise<LibraryStore> => ({
        ...await openLibraryStore(),
        putThumbnail: () => Promise.reject(new DOMException('容量不足', 'QuotaExceededError')),
      })
      const { user, container } = await setup(memory.source, openStore, createMaker())

      await openFolder(user)

      await waitFor(() => expect(cardImages(container)).toBe(3))
      expect(container.querySelector('.photo-card .thumbnail-state')).toBeNull()
    })
  })

  it('写真を選ぶと詳細表示が切り替わる', async () => {
    const memory = createPicturesSource()
    memory.queuePick('pictures')
    const { user, inspectorTitle } = await setup(memory.source)
    await openFolder(user)

    await user.click(screen.getByRole('button', { name: /station\.png/ }))

    expect(inspectorTitle()).toBe('station.png')
    expect(screen.getByRole('button', { name: /station\.png/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Pictures / trip')).toBeInTheDocument()
    expect(screen.getByText(/^PNG ·/)).toBeInTheDocument()
  })

  describe('コレクション', () => {
    /**
     * サイドバーでコレクションを作る。
     * 保存し終えて入力欄が閉じるか、使えない名前として入力欄に誤りが示されるまで待つ。
     * @param user 操作用の userEvent
     * @param name コレクション名
     */
    const createCollection = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
      await user.click(screen.getByRole('button', { name: 'コレクションを作る' }))
      await user.type(screen.getByRole('textbox', { name: 'コレクション名' }), name)
      await user.click(screen.getByRole('button', { name: '作成' }))
      await waitFor(() => {
        const input = screen.queryByRole('textbox', { name: 'コレクション名' })
        expect(input === null || input.getAttribute('aria-invalid') === 'true').toBe(true)
      })
    }

    /**
     * 写真を選び、詳細表示から既存のコレクションに入れる。
     * @param user 操作用の userEvent
     * @param photoName 写真のファイル名
     * @param collectionName コレクション名
     */
    const addToCollection = async (
      user: ReturnType<typeof userEvent.setup>, photoName: string, collectionName: string,
    ) => {
      await user.click(screen.getByRole('button', { name: new RegExp(photoName.replace('.', '\\.')) }))
      await user.click(within(inspector()).getByRole('button', { name: '＋ 追加' }))
      const candidates = within(inspector()).getByRole('list', { name: '追加できるコレクション' })
      await user.click(within(candidates).getByRole('button', { name: collectionName }))
    }

    /**
     * 詳細表示を取得する。
     * @returns 詳細表示の要素
     */
    const inspector = () => screen.getByRole('complementary', { name: '写真の詳細' })

    it('サイドバーで作ると空のコレクションを表示し、同じ名前は作れない', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)

      expect(within(nav()).getByText('まだコレクションがありません')).toBeInTheDocument()
      await createCollection(user, 'Trip')

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trip')
      expect(screen.getByText('このコレクションにはまだ写真がありません')).toBeInTheDocument()
      expect(photoTitles()).toEqual([])
      expect(within(nav()).getByRole('button', { name: /Trip/ })).toHaveAttribute('aria-current', 'page')

      await createCollection(user, ' ｔｒｉｐ ')

      const input = screen.getByRole('textbox', { name: 'コレクション名' })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription('「ｔｒｉｐ」という名前のコレクションはすでにあります。')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('textbox', { name: 'コレクション名' })).not.toBeInTheDocument()
      expect(within(nav()).getAllByRole('button', { name: /trip/i })).toHaveLength(1)
    })

    it('詳細表示から写真を入れ、1 枚を複数のコレクションに入れられる', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)
      await createCollection(user, 'Trip')
      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))

      expect(within(inspector()).getByText('未登録')).toBeInTheDocument()
      await addToCollection(user, 'station.png', 'Trip')

      expect(within(inspector()).getByRole('button', { name: '「Trip」から外す' })).toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: /Trip/ })).toHaveTextContent(/1$/)

      await user.click(within(inspector()).getByRole('button', { name: '＋ 追加' }))
      await user.type(within(inspector()).getByRole('textbox', { name: '新しいコレクションの名前' }), 'お気に入り')
      await user.click(within(inspector()).getByRole('button', { name: '作って追加' }))

      expect(await within(inspector()).findByRole('button', { name: '「お気に入り」から外す' })).toBeInTheDocument()
      expect(within(inspector()).getByRole('button', { name: '「Trip」から外す' })).toBeInTheDocument()
      expect(photoTitles()).toHaveLength(3)

      await user.click(within(nav()).getByRole('button', { name: /お気に入り/ }))
      expect(screen.getByRole('heading', { level: 1 }).previousElementSibling).toHaveTextContent('コレクション')
      expect(photoTitles()).toEqual(['station.png'])
    })

    it('コレクションから外すと一覧から消え、写真はライブラリに残る', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)
      await createCollection(user, 'Trip')
      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await addToCollection(user, 'station.png', 'Trip')
      await addToCollection(user, 'morning.jpg', 'Trip')
      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))

      expect(photoTitles()).toEqual(['morning.jpg', 'station.png'])
      await user.click(screen.getByRole('button', { name: /station\.png/ }))
      await user.click(within(inspector()).getByRole('button', { name: '「Trip」から外す' }))

      expect(photoTitles()).toEqual(['morning.jpg'])
      expect(within(nav()).getByRole('button', { name: /すべての写真/ })).toHaveTextContent(/3$/)
    })

    it('開き直してもコレクションと所属が残る', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const first = await setup(memory.source)
      await openFolder(first.user)
      await createCollection(first.user, 'Trip')
      await first.user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await addToCollection(first.user, 'window.webp', 'Trip')
      first.unmount()

      const { user, photoTitles } = await setup(memory.source)
      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))

      expect(photoTitles()).toEqual(['window.webp'])
    })

    it('名前を変更できる。ほかのコレクションと同じ名前にはできない', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user } = await setup(memory.source)
      await openFolder(user)
      await createCollection(user, 'お気に入り')
      await createCollection(user, 'Trip')

      await user.click(screen.getByRole('button', { name: '名前を変更' }))
      const input = screen.getByRole('textbox', { name: '新しいコレクション名' })
      expect(input).toHaveValue('Trip')
      await user.clear(input)
      await user.type(input, 'お気に入り')
      await user.click(screen.getByRole('button', { name: '変更' }))
      expect(input).toHaveAccessibleDescription('「お気に入り」という名前のコレクションはすでにあります。')

      await user.clear(input)
      await user.type(input, '旅行')
      await user.click(screen.getByRole('button', { name: '変更' }))

      // 名前は保存し終えてから画面に反映されるため、反映を待つ
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('旅行'))
      expect(screen.queryByRole('textbox', { name: '新しいコレクション名' })).not.toBeInTheDocument()
      expect(within(nav()).getByRole('button', { name: /旅行/ })).toHaveAttribute('aria-current', 'page')
    })

    it('確認してから削除し、写真はライブラリに残す', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)
      await createCollection(user, 'Trip')
      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await addToCollection(user, 'station.png', 'Trip')
      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))

      await user.click(screen.getByRole('button', { name: '削除' }))
      const confirm = screen.getByRole('alert')
      expect(confirm).toHaveTextContent('コレクション「Trip」を削除しますか？')
      await user.click(within(confirm).getByRole('button', { name: 'やめる' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(photoTitles()).toEqual(['station.png'])

      await user.click(screen.getByRole('button', { name: '削除' }))
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: '削除する' }))

      expect(await screen.findByRole('heading', { level: 1, name: 'すべての写真' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('コレクション「Trip」を削除しました。')
      expect(within(nav()).queryByRole('button', { name: /Trip/ })).not.toBeInTheDocument()
      expect(photoTitles()).toHaveLength(3)
      await user.click(screen.getByRole('button', { name: /station\.png/ }))
      expect(within(inspector()).getByText('未登録')).toBeInTheDocument()
    })
  })

  describe('検索', () => {
    /**
     * 検索欄に入力する。
     * @param user 操作用の userEvent
     * @param query 検索語
     */
    const search = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
      const input = screen.getByRole('searchbox', { name: '写真を検索' })
      await user.clear(input)
      await user.type(input, query)
    }

    it('ファイル名やフォルダ名で絞り込み、件数を表示する', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)

      await search(user, 'trip')
      await waitFor(() => expect(photoTitles()).toEqual(['station.png']))
      expect(screen.getByText('1 件の検索結果')).toBeInTheDocument()

      await search(user, 'ＷＩＮＤＯＷ　webp')
      await waitFor(() => expect(photoTitles()).toEqual(['window.webp']))

      await search(user, 'pictures')
      await waitFor(() => expect(photoTitles()).toHaveLength(3))

      await user.clear(screen.getByRole('searchbox', { name: '写真を検索' }))
      await waitFor(() => expect(screen.getByText('3 枚')).toBeInTheDocument())
    })

    it('一致する写真がなければ案内を出す', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)

      await search(user, 'sunset')

      expect(await screen.findByText('「sunset」に一致する写真はありません')).toBeInTheDocument()
      expect(photoTitles()).toEqual([])
      expect(screen.getByText('0 件の検索結果')).toBeInTheDocument()
    })

    it('表示中のコレクションの中から探す', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, photoTitles } = await setup(memory.source)
      await openFolder(user)
      await user.click(screen.getByRole('button', { name: 'コレクションを作る' }))
      await user.type(screen.getByRole('textbox', { name: 'コレクション名' }), 'Trip')
      await user.click(screen.getByRole('button', { name: '作成' }))
      await user.click(within(nav()).getByRole('button', { name: /すべての写真/ }))
      await user.click(screen.getByRole('button', { name: /window\.webp/ }))
      const inspector = screen.getByRole('complementary', { name: '写真の詳細' })
      await user.click(within(inspector).getByRole('button', { name: '＋ 追加' }))
      await user.click(within(inspector).getByRole('button', { name: 'Trip' }))
      await user.click(within(nav()).getByRole('button', { name: /Trip/ }))

      await search(user, 'station')
      expect(await screen.findByText('「station」に一致する写真はありません')).toBeInTheDocument()

      await search(user, 'window')
      await waitFor(() => expect(photoTitles()).toEqual(['window.webp']))
    })
  })

  describe('狭い画面', () => {
    it('メニューを開き、表示範囲を選ぶか閉じるボタンや Esc キーで閉じる', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, container } = await setup(memory.source)
      await openFolder(user)
      const menuButton = screen.getByRole('button', { name: 'メニューを開く' })
      /**
       * サイドバーを開いているか調べる。
       * @returns 開いていれば `'true'`
       */
      const sidebarOpen = () => container.querySelector('aside')?.dataset.open

      expect(sidebarOpen()).toBe('false')
      await user.click(menuButton)
      expect(sidebarOpen()).toBe('true')
      expect(menuButton).toHaveAttribute('aria-expanded', 'true')
      await user.click(within(nav()).getByRole('button', { name: /再接続が必要/ }))
      expect(sidebarOpen()).toBe('false')

      await user.click(menuButton)
      await user.click(screen.getByRole('button', { name: 'メニューを閉じる' }))
      expect(sidebarOpen()).toBe('false')

      await user.click(menuButton)
      await user.keyboard('{Escape}')
      expect(sidebarOpen()).toBe('false')
    })

    it('写真を選ぶと詳細表示を開き、閉じるボタンで閉じる', async () => {
      const memory = createPicturesSource()
      memory.queuePick('pictures')
      const { user, inspectorTitle } = await setup(memory.source)
      await openFolder(user)
      const inspector = screen.getByRole('complementary', { name: '写真の詳細' })

      expect(inspector).toHaveAttribute('data-open', 'false')
      await user.click(screen.getByRole('button', { name: /station\.png/ }))
      expect(inspector).toHaveAttribute('data-open', 'true')
      expect(inspectorTitle()).toBe('station.png')

      await user.click(within(inspector).getByRole('button', { name: '詳細を閉じる' }))
      expect(inspector).toHaveAttribute('data-open', 'false')
    })
  })
})
