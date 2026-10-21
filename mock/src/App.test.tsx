import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

/**
 * App を描画し、操作用の userEvent と画面の状態を読む関数を用意する。
 * @returns `user`（操作用の userEvent）、`photoTitles`、`inspectorTitle` をまとめたオブジェクト
 */
const setup = () => {
  const user = userEvent.setup()
  const { container } = render(<App />)
  /**
   * 写真一覧に表示中の写真のタイトルを取得する。
   * @returns 表示順に並べたタイトルの配列
   */
  const photoTitles = () => Array.from(container.querySelectorAll('.photo-card strong'), (element) => element.textContent)
  /**
   * 詳細表示に出ている写真のタイトルを取得する。
   * @returns 写真のタイトル。詳細表示が空のときは `undefined`
   */
  const inspectorTitle = () => container.querySelector('.inspector h2')?.textContent
  return { user, photoTitles, inspectorTitle }
}

describe('App', () => {
  it('初期表示で全写真と先頭の写真の詳細を表示する', () => {
    const { photoTitles, inspectorTitle } = setup()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('すべての写真')
    expect(photoTitles()).toHaveLength(8)
    expect(inspectorTitle()).toBe('朝の余白')
    expect(screen.getByText('2026年10月')).toBeInTheDocument()
  })

  describe('検索', () => {
    it('タイトルで絞り込み、件数を表示する', async () => {
      const { user, photoTitles } = setup()

      await user.type(screen.getByPlaceholderText('写真を検索'), '窓辺')

      expect(photoTitles()).toEqual(['窓辺'])
      expect(screen.getByText('1 件の検索結果')).toBeInTheDocument()
    })

    it('場所で絞り込む', async () => {
      const { user, photoTitles } = setup()

      await user.type(screen.getByPlaceholderText('写真を検索'), '鎌倉')

      expect(photoTitles()).toEqual(['朝の余白', '帰り道'])
    })

    it('タグで絞り込む', async () => {
      const { user, photoTitles } = setup()

      await user.type(screen.getByPlaceholderText('写真を検索'), '植物')

      expect(photoTitles()).toEqual(['初秋'])
    })

    it('前後の空白を無視する', async () => {
      const { user, photoTitles } = setup()

      await user.type(screen.getByPlaceholderText('写真を検索'), '  窓辺  ')

      expect(photoTitles()).toEqual(['窓辺'])
    })

    it('該当がなければ空の状態を表示する', async () => {
      const { user, photoTitles } = setup()

      await user.type(screen.getByPlaceholderText('写真を検索'), '存在しない写真')

      expect(photoTitles()).toHaveLength(0)
      expect(screen.getByRole('heading', { name: '写真が見つからない' })).toBeInTheDocument()
      expect(screen.getByText('0 件の検索結果')).toBeInTheDocument()
    })

    it('検索語を消すと全写真に戻る', async () => {
      const { user, photoTitles } = setup()
      const input = screen.getByPlaceholderText('写真を検索')

      await user.type(input, '窓辺')
      await user.clear(input)

      expect(photoTitles()).toHaveLength(8)
      expect(screen.getByText('2026年10月')).toBeInTheDocument()
    })
  })

  describe('コレクション', () => {
    it('選ぶと見出しが変わり、写真が絞り込まれる', async () => {
      const { user, photoTitles, inspectorTitle } = setup()
      const nav = screen.getByRole('navigation')

      await user.click(within(nav).getByRole('button', { name: /^散歩/ }))

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('散歩')
      expect(photoTitles()).toEqual(['朝の余白', '初秋', '帰り道'])
      expect(within(nav).getByRole('button', { name: /^散歩/ })).toHaveClass('active')
      expect(inspectorTitle()).toBe('朝の余白')
    })

    it('検索と組み合わせて絞り込む', async () => {
      const { user, photoTitles } = setup()

      await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /^散歩/ }))
      await user.type(screen.getByPlaceholderText('写真を検索'), '鎌倉')

      expect(photoTitles()).toEqual(['朝の余白', '帰り道'])
    })

    it('「すべての写真」で全写真に戻る', async () => {
      const { user, photoTitles } = setup()
      const nav = screen.getByRole('navigation')

      await user.click(within(nav).getByRole('button', { name: /^2026 秋/ }))
      expect(photoTitles()).toHaveLength(6)

      await user.click(within(nav).getByRole('button', { name: /すべての写真/ }))

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('すべての写真')
      expect(photoTitles()).toHaveLength(8)
    })

    it('「海のある日」は該当する写真がなく、空の状態を表示する', async () => {
      const { user, photoTitles, inspectorTitle } = setup()

      await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /^海のある日/ }))

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('海のある日')
      expect(photoTitles()).toHaveLength(0)
      expect(screen.getByRole('heading', { name: '写真が見つからない' })).toBeInTheDocument()
      expect(inspectorTitle()).toBeUndefined()
    })
  })

  it('写真を選ぶと詳細表示が切り替わる', async () => {
    const { user, inspectorTitle } = setup()

    await user.click(screen.getByRole('button', { name: /夕方の駅/ }))

    expect(inspectorTitle()).toBe('夕方の駅')
    expect(screen.getByRole('button', { name: /夕方の駅/ })).toHaveClass('selected')
    expect(screen.getByText('横浜')).toBeInTheDocument()
  })

  describe('通知', () => {
    it('未実装の操作で通知を表示し、× で閉じる', async () => {
      const { user } = setup()

      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /フォルダを開く/ }))

      const toast = screen.getByRole('status')
      expect(toast).toHaveTextContent('これはモックです。フォルダ選択は未実装です。')

      await user.click(within(toast).getByRole('button', { name: '×' }))

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('別の操作で通知の内容が置き換わる', async () => {
      const { user } = setup()

      await user.click(screen.getByRole('button', { name: /フォルダを開く/ }))
      await user.click(screen.getByRole('button', { name: /再接続が必要/ }))

      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(screen.getByRole('status')).toHaveTextContent('参照切れの写真はありません。')
    })
  })
})
