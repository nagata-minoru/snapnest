import type { PhotoRecord } from '../db/libraryStore'
import type { PhotoSource } from '../fs/photoSource'
import type { Library } from '../library/useLibrary'
import type { LibraryIndex } from '../library/useLibraryIndex'
import type { View } from '../library/view'
import type { ThumbnailMaker } from '../thumbnails/thumbnailMaker'
import { EmptyState } from './EmptyState'
import { PhotoCard } from './PhotoCard'
import { folderButton } from './styles'

/**
 * 写真の枚数と一覧。表示する写真がなければ、状況に応じた案内を出す。
 * @param props.library ライブラリの状態と操作
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.makeThumbnail 原本からサムネイルを作る関数
 * @param props.view 表示中の範囲
 * @param props.index 並べ替えと絞り込みを済ませた写真
 * @param props.query 絞り込みに使った検索欄の入力
 * @param props.selectedId 選択中の写真の ID。選んでいなければ `undefined`
 * @param props.onSelect 写真が選ばれたときに呼ばれる
 * @returns 写真の枚数と一覧、または案内の React 要素
 */
export const PhotoList = ({
  library, source, makeThumbnail, view, index, query, selectedId, onSelect,
}: {
  library: Library
  source: PhotoSource
  makeThumbnail: ThumbnailMaker
  view: View
  index: LibraryIndex
  query: string
  selectedId: string | undefined
  onSelect: (photoId: string) => void
}) => {
  const { folders, scan } = library
  const { support } = source
  const { visiblePhotos: photos, searching, isAccessible } = index
  const countLabel = searching ? `${photos.length} 件の検索結果` : `${photos.length} 枚`

  /**
   * 写真の一覧を描画する。表示する写真がなければ、状況に応じた案内を出す。
   * @returns 写真の一覧または案内の React 要素
   */
  const renderPhotos = () => {
    if (library.status === 'loading' && library.storeIssue === 'blocked') {
      return (
        <EmptyState title="ほかのタブの snapnest を待っています">
          <p>古い版の snapnest を開いたままのタブがあります。そのタブを閉じると、続きを読み込みます。</p>
        </EmptyState>
      )
    }
    if (library.status === 'loading') return <EmptyState title="ライブラリを読み込み中…" />
    if (photos.length) {
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[18px] gap-y-6">
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              source={source}
              thumbnails={library.thumbnails}
              makeThumbnail={makeThumbnail}
              photo={photo}
              accessible={isAccessible(photo)}
              selected={selectedId === photo.id}
              onSelect={onSelect}
              onUnavailable={library.reportUnavailable}
            />
          ))}
        </div>
      )
    }
    if (folders.length === 0 && support !== 'supported') {
      const where = support === 'insecure-context' ? 'このアドレス' : 'このブラウザ'
      return <EmptyState icon="▣" title={`${where}ではフォルダを開けません`} />
    }
    if (folders.length === 0) {
      return (
        <EmptyState icon="▣" title="写真のフォルダを開きましょう">
          <p>選んだフォルダの写真を、コピーせずにそのまま参照します。</p>
          <button
            className={`${folderButton} mx-auto mt-[18px] w-fit px-[18px]`}
            disabled={!!scan}
            onClick={library.addFolder}
          >
            <span>＋</span> フォルダを開く
          </button>
        </EmptyState>
      )
    }
    if (searching) {
      return (
        <EmptyState icon="⌕" title={`「${query.trim()}」に一致する写真はありません`}>
          <p>ファイル名やフォルダ名の一部で探せます。</p>
        </EmptyState>
      )
    }
    if (view.kind === 'missing') return <EmptyState icon="⌁" title="再接続が必要な写真はありません" />
    if (view.kind === 'collection') {
      return (
        <EmptyState icon="◇" title="このコレクションにはまだ写真がありません">
          <p>写真を選び、詳細表示の「コレクション」から追加できます。</p>
        </EmptyState>
      )
    }
    return (
      <EmptyState icon="▦" title="表示できる写真がありません">
        <p>対応している形式は JPEG、PNG、GIF、WebP、AVIF、BMP です。</p>
      </EmptyState>
    )
  }

  return (
    <>
      <div className="mt-8 mb-[17px] text-xs text-[#66736b] lg:mt-[39px]">
        {library.status === 'ready' ? countLabel : ''}
      </div>
      {renderPhotos()}
    </>
  )
}
