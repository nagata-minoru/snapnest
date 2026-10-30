import type { CollectionRecord, FolderRecord } from '../db/libraryStore'
import type { View } from '../library/view'
import type { CollectionEdit } from './CollectionEditor'
import { toolButton } from './styles'

/**
 * 写真一覧の見出し。表示範囲の名前、検索欄、表示範囲ごとの操作ボタンを出す。
 * @param props.view 表示中の範囲
 * @param props.navOpen 狭い画面でサイドバーを開いているか
 * @param props.onOpenNav メニューを開くボタンが押されたときに呼ばれる
 * @param props.query 検索欄の入力
 * @param props.onQueryChange 検索欄が書き換えられたときに呼ばれる
 * @param props.currentFolder 表示中のフォルダ。フォルダを表示していなければ `undefined`
 * @param props.currentCollection 表示中のコレクション。コレクションを表示していなければ `undefined`
 * @param props.scanning フォルダを読み込み中か
 * @param props.onRescan フォルダの再読み込みが押されたときに呼ばれる
 * @param props.onEditCollection コレクションの名前変更か削除が押されたときに呼ばれる
 * @returns 見出しの React 要素
 */
export const LibraryHeader = ({
  view, navOpen, onOpenNav, query, onQueryChange, currentFolder, currentCollection, scanning, onRescan,
  onEditCollection,
}: {
  view: View
  navOpen: boolean
  onOpenNav: () => void
  query: string
  onQueryChange: (query: string) => void
  currentFolder: FolderRecord | undefined
  currentCollection: CollectionRecord | undefined
  scanning: boolean
  onRescan: (folderId: string) => void
  onEditCollection: (edit: Exclude<CollectionEdit, null>) => void
}) => {
  const title = view.kind === 'missing' ? '再接続が必要' : (currentFolder ?? currentCollection)?.name ?? 'すべての写真'
  const eyebrow = currentFolder ? 'フォルダ' : currentCollection ? 'コレクション' : 'ライブラリ'

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="flex-none rounded-lg border border-line bg-white px-2.5 py-1.5 text-slate lg:hidden"
          aria-label="メニューを開く"
          aria-expanded={navOpen}
          onClick={onOpenNav}
        >
          ☰
        </button>
        <div className="min-w-0">
          <p className="mb-[3px] text-[11px] text-muted">{eyebrow}</p>
          <h1 className="truncate text-2xl font-bold tracking-[-1.2px] text-ink-strong sm:text-[28px]">{title}</h1>
        </div>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <input
          type="search"
          className={(
            'min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none ' +
            'placeholder:text-faint focus:border-accent sm:w-56 sm:flex-none'
          )}
          aria-label="写真を検索"
          placeholder="ファイル名で検索"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {currentFolder && (
          <button className={toolButton} disabled={scanning} onClick={() => onRescan(currentFolder.id)}>
            ↻ 再読み込み
          </button>
        )}
        {currentCollection && (
          <>
            <button className={toolButton} onClick={() => onEditCollection('rename')}>名前を変更</button>
            <button className={toolButton} onClick={() => onEditCollection('delete')}>削除</button>
          </>
        )}
      </div>
    </header>
  )
}
