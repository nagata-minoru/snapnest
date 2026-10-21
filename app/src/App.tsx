import { useMemo, useState } from 'react'
import { Inspector } from './components/Inspector'
import { PhotoCard } from './components/PhotoCard'
import type { LibraryStore, PhotoRecord } from './db/libraryStore'
import type { PhotoSource } from './fs/photoSource'
import { useLibrary } from './library/useLibrary'
import { noThumbnail, type ThumbnailMaker } from './thumbnails/thumbnailMaker'

/** 写真一覧に表示する範囲 */
type View = { kind: 'all' } | { kind: 'missing' } | { kind: 'folder'; folderId: string }

/**
 * 写真を新しい順に並べるための比較関数。更新日時が同じなら相対パス順にする。
 * @param a 比べる写真
 * @param b 比べる写真
 * @returns 並び順を表す数
 */
const byNewest = (a: PhotoRecord, b: PhotoRecord) => (
  b.lastModified - a.lastModified || a.relativePath.localeCompare(b.relativePath)
)

/**
 * 写真が表示範囲に含まれるか判定する。
 * @param photo 写真
 * @param view 表示範囲
 * @returns 含まれるなら `true`
 */
const isInView = (photo: PhotoRecord, view: View) => (
  view.kind === 'all' ||
  (view.kind === 'missing' && photo.status === 'missing') ||
  (view.kind === 'folder' && photo.folderId === view.folderId)
)

/**
 * snapnest の写真ライブラリ画面。
 * サイドバー、写真一覧、詳細表示、通知を描画する。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.openStore メタデータの保存先を開く関数
 * @param props.makeThumbnail 原本からサムネイルを作る関数。省略するとサムネイルを作らず原本を表示する
 * @returns 写真ライブラリ画面全体の React 要素
 */
export const App = ({ source, openStore, makeThumbnail = noThumbnail }: {
  source: PhotoSource
  openStore: () => Promise<LibraryStore>
  makeThumbnail?: ThumbnailMaker
}) => {
  const library = useLibrary(source, openStore)
  const { folders, permissions, scan } = library
  const [view, setView] = useState<View>({ kind: 'all' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sortedPhotos = useMemo(() => [...library.photos].sort(byNewest), [library.photos])
  const visiblePhotos = useMemo(() => sortedPhotos.filter((photo) => isInView(photo, view)), [sortedPhotos, view])
  const missingCount = useMemo(
    () => library.photos.filter((photo) => photo.status === 'missing').length,
    [library.photos],
  )
  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>()
    for (const photo of library.photos) counts.set(photo.folderId, (counts.get(photo.folderId) ?? 0) + 1)
    return counts
  }, [library.photos])
  const selectedPhoto = visiblePhotos.find((photo) => photo.id === selectedId) ?? visiblePhotos[0]
  const currentFolder = view.kind === 'folder' ? folders.find((folder) => folder.id === view.folderId) : undefined
  const scanningFolder = scan && folders.find((folder) => folder.id === scan.folderId)
  const foldersNeedingAccess = folders.filter((folder) => (
    permissions[folder.id] !== 'granted' && (view.kind !== 'folder' || folder.id === view.folderId)
  ))
  const title = view.kind === 'missing' ? '再接続が必要' : currentFolder?.name ?? 'すべての写真'

  /**
   * 表示範囲を切り替え、写真の選択を解除する。
   * @param next 新しい表示範囲
   */
  const chooseView = (next: View) => {
    setView(next)
    setSelectedId(null)
  }

  /**
   * 表示範囲が選択中のものか判定する。
   * @param target 調べる表示範囲
   * @returns 選択中なら `true`
   */
  const isActive = (target: View) => (
    target.kind === view.kind &&
    (target.kind !== 'folder' || view.kind !== 'folder' || target.folderId === view.folderId)
  )

  /**
   * 写真の入っているフォルダにアクセスできるか判定する。
   * @param photo 写真
   * @returns アクセスが許可されていれば `true`
   */
  const isAccessible = (photo: PhotoRecord) => permissions[photo.folderId] === 'granted'

  /**
   * サイドバーの下部に出す状態の説明を作る。
   * @returns 読み込みの進み具合、または保存の状態を表す文
   */
  const footerStatus = () => {
    if (scan && scanningFolder) return `「${scanningFolder.name}」を読み込み中… ${scan.found} 枚`
    if (library.persistent) return '端末内のフォルダを参照中'
    return '登録内容は保存されません'
  }

  /**
   * 写真の一覧を描画する。表示する写真がなければ、状況に応じた案内を出す。
   * @returns 写真の一覧または案内の React 要素
   */
  const renderPhotos = () => {
    if (library.status === 'loading') return <div className="empty"><p>ライブラリを読み込み中…</p></div>
    if (visiblePhotos.length) {
      return (
        <div className="photo-grid">
          {visiblePhotos.map((photo) => (
            <PhotoCard
              key={photo.id}
              source={source}
              thumbnails={library.thumbnails}
              makeThumbnail={makeThumbnail}
              photo={photo}
              accessible={isAccessible(photo)}
              selected={selectedPhoto?.id === photo.id}
              onSelect={setSelectedId}
              onUnavailable={library.reportUnavailable}
            />
          ))}
        </div>
      )
    }
    if (folders.length === 0) {
      return (
        <div className="empty">
          <span>▣</span>
          <h2>写真のフォルダを開きましょう</h2>
          <p>選んだフォルダの写真を、コピーせずにそのまま参照します。</p>
          <button className="folder-button inline" disabled={!!scan} onClick={library.addFolder}>
            <span>＋</span> フォルダを開く
          </button>
        </div>
      )
    }
    if (view.kind === 'missing') {
      return (
        <div className="empty">
          <span>⌁</span>
          <h2>再接続が必要な写真はありません</h2>
        </div>
      )
    }
    return (
      <div className="empty">
        <span>▦</span>
        <h2>表示できる写真がありません</h2>
        <p>対応している形式は JPEG、PNG、GIF、WebP、AVIF、BMP です。</p>
      </div>
    )
  }

  /**
   * 選択中の写真の詳細を描画する。
   * @returns 詳細表示、または写真を選ぶよう促す案内の React 要素
   */
  const renderInspector = () => {
    if (!selectedPhoto) return <p className="inspector-empty">写真を選ぶと、ここに詳細を表示します。</p>
    return (
      <Inspector
        key={selectedPhoto.id}
        source={source}
        thumbnails={library.thumbnails}
        photo={selectedPhoto}
        folder={folders.find((folder) => folder.id === selectedPhoto.folderId)}
        accessible={isAccessible(selectedPhoto)}
        scanning={!!scan}
        onUnavailable={library.reportUnavailable}
        onRequestAccess={library.requestAccess}
        onRescan={library.rescan}
      />
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">⌁</span><span>snapnest</span></div>
        <button className="folder-button" disabled={library.status !== 'ready' || !!scan} onClick={library.addFolder}>
          <span>＋</span> フォルダを開く
        </button>
        <nav>
          <p className="nav-label">ライブラリ</p>
          <button
            className={`nav-item ${isActive({ kind: 'all' }) ? 'active' : ''}`}
            onClick={() => chooseView({ kind: 'all' })}
          >
            <span>▦</span> すべての写真 <b>{library.photos.length}</b>
          </button>
          <button
            className={`nav-item muted ${isActive({ kind: 'missing' }) ? 'active' : ''}`}
            onClick={() => chooseView({ kind: 'missing' })}
          >
            <span>⌁</span> 再接続が必要 <b>{missingCount}</b>
          </button>
          <p className="nav-label">フォルダ</p>
          {folders.length === 0 && <p className="nav-empty">まだフォルダがありません</p>}
          {folders.map((folder, index) => (
            <button
              key={folder.id}
              className={`nav-item collection ${isActive({ kind: 'folder', folderId: folder.id }) ? 'active' : ''}`}
              onClick={() => chooseView({ kind: 'folder', folderId: folder.id })}
            >
              <span className={`dot dot-${index % 4}`} /> {folder.name}
              {permissions[folder.id] !== 'granted' && <small className="nav-warning">要許可</small>}
              <b>{countsByFolder.get(folder.id) ?? 0}</b>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>
            <span className={`status-dot ${library.persistent ? '' : 'warning'}`} />
            {footerStatus()}
          </p>
          <p className="storage-note">
            ブラウザのサイトデータを削除したりシークレットモードで開いたりすると、
            登録したフォルダや写真の情報、サムネイルは失われます。写真の原本は消えません。
          </p>
        </div>
      </aside>

      <section className="library">
        <header className="topbar">
          <div><p className="eyebrow">{currentFolder ? 'フォルダ' : 'ライブラリ'}</p><h1>{title}</h1></div>
          {currentFolder && (
            <div className="toolbar">
              <button className="text-button" disabled={!!scan} onClick={() => library.rescan(currentFolder.id)}>
                ↻ 再読み込み
              </button>
            </div>
          )}
        </header>

        {!source.supported && (
          <div className="banner" role="alert">
            このブラウザはフォルダの参照に対応していません。snapnest は現在 Chrome を対象にしています。
          </div>
        )}
        {foldersNeedingAccess.map((folder) => (
          <div key={folder.id} className="banner">
            <span>
              「{folder.name}」へのアクセス許可が必要です。
              {permissions[folder.id] === 'denied' ? 'アクセスが拒否されています。' : ''}
            </span>
            <button onClick={() => library.requestAccess(folder.id)}>アクセスを許可</button>
          </div>
        ))}

        <div className="subbar">
          <span>{library.status === 'ready' ? `${visiblePhotos.length} 枚` : ''}</span>
        </div>
        {renderPhotos()}
      </section>

      <aside className="inspector">{renderInspector()}</aside>
      {library.notice && (
        <div className="toast" role="status">
          {library.notice}
          <button aria-label="通知を閉じる" onClick={library.dismissNotice}>×</button>
        </div>
      )}
    </main>
  )
}
