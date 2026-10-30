import { useDeferredValue, useState } from 'react'
import { CollectionEditor, type CollectionEdit } from './components/CollectionEditor'
import { InspectorPanel } from './components/InspectorPanel'
import { LibraryBanners } from './components/LibraryBanners'
import { LibraryHeader } from './components/LibraryHeader'
import { PhotoList } from './components/PhotoList'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { useDrawers } from './components/useDrawers'
import type { OpenLibraryStore } from './db/libraryStore'
import type { PhotoSource } from './fs/photoSource'
import { useLibrary } from './library/useLibrary'
import { useLibraryIndex } from './library/useLibraryIndex'
import type { View } from './library/view'
import { noThumbnail, type ThumbnailMaker } from './thumbnails/thumbnailMaker'

/**
 * snapnest の写真ライブラリ画面。
 * サイドバー、写真一覧、詳細表示、通知を描画する。
 * 狭い画面では、サイドバーと詳細表示を必要なときだけ重ねて開く。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.openStore メタデータの保存先を開く関数
 * @param props.makeThumbnail 原本からサムネイルを作る関数。省略するとサムネイルを作らず原本を表示する
 * @returns 写真ライブラリ画面全体の React 要素
 */
export const App = ({ source, openStore, makeThumbnail = noThumbnail }: {
  source: PhotoSource
  openStore: OpenLibraryStore
  makeThumbnail?: ThumbnailMaker
}) => {
  const library = useLibrary(source, openStore)
  // 接続が閉じた後は、画面に残った内容を変えても保存されない
  const saving = library.persistent && library.storeIssue !== 'closed'
  const [view, setView] = useState<View>({ kind: 'all' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 入力を妨げないよう、絞り込みは入力より遅れてよいものとして扱う
  const deferredQuery = useDeferredValue(query)
  const [collectionEdit, setCollectionEdit] = useState<CollectionEdit>(null)
  const { navOpen, setNavOpen, inspectorOpen, setInspectorOpen, closeDrawers } = useDrawers()

  const index = useLibraryIndex(library, view, deferredQuery)
  const selectedPhoto = index.visiblePhotos.find((photo) => photo.id === selectedId) ?? index.visiblePhotos[0]
  const currentFolder = (
    view.kind === 'folder' ? library.folders.find((folder) => folder.id === view.folderId) : undefined
  )
  const currentCollection = (
    view.kind === 'collection' ? library.collections.find((item) => item.id === view.collectionId) : undefined
  )

  /**
   * 表示範囲を切り替え、写真の選択を解除する。狭い画面ではサイドバーを閉じる。
   * @param next 新しい表示範囲
   */
  const chooseView = (next: View) => {
    setView(next)
    setSelectedId(null)
    setNavOpen(false)
    setCollectionEdit(null)
  }

  /**
   * 写真を選び、狭い画面では詳細表示を開く。
   * @param photoId 選んだ写真の ID
   */
  const selectPhoto = (photoId: string) => {
    setSelectedId(photoId)
    setInspectorOpen(true)
  }

  return (
    <main className="h-dvh lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[235px_minmax(0,1fr)_294px]">
      <Sidebar
        library={library}
        support={source.support}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        saving={saving}
        view={view}
        onChooseView={chooseView}
        index={index}
      />

      <section className="h-full overflow-y-auto px-4 pt-6 pb-8 sm:px-7 lg:px-10 lg:pt-9">
        <LibraryHeader
          view={view}
          navOpen={navOpen}
          onOpenNav={() => setNavOpen(true)}
          query={query}
          onQueryChange={setQuery}
          currentFolder={currentFolder}
          currentCollection={currentCollection}
          scanning={!!library.scan}
          onRescan={library.rescan}
          onEditCollection={setCollectionEdit}
        />
        {currentCollection && (
          <CollectionEditor
            library={library}
            collection={currentCollection}
            edit={collectionEdit}
            onClose={() => setCollectionEdit(null)}
            onDeleted={() => chooseView({ kind: 'all' })}
          />
        )}
        <LibraryBanners
          library={library}
          support={source.support}
          view={view}
          withCandidatesCount={index.withCandidatesCount}
        />
        <PhotoList
          library={library}
          source={source}
          makeThumbnail={makeThumbnail}
          view={view}
          index={index}
          query={deferredQuery}
          selectedId={selectedPhoto?.id}
          onSelect={selectPhoto}
        />
      </section>

      <InspectorPanel
        library={library}
        source={source}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        photo={selectedPhoto}
        index={index}
        onSelect={setSelectedId}
      />
      {(navOpen || inspectorOpen) && (
        <div
          className={`fixed inset-0 z-20 bg-ink/30 ${navOpen ? 'lg:hidden' : 'xl:hidden'}`}
          aria-hidden="true"
          onClick={closeDrawers}
        />
      )}
      <Toast notice={library.notice} onDismiss={library.dismissNotice} />
    </main>
  )
}
