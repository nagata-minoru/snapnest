import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

/** 黄緑の「フォルダを開く」ボタンの見た目 */
const folderButton = (
  'flex items-center justify-center gap-[9px] rounded-[9px] bg-leaf p-3 text-[13px] font-extrabold text-leaf-ink'
)

/** サイドバーの見出しの見た目 */
const navLabel = 'mx-[9px] mb-[9px] text-[10px] font-bold tracking-widest text-sidebar-dim'

/** 一覧の上に出す警告の見た目 */
const banner = (
  'mt-[18px] flex items-center justify-between gap-3 rounded-lg bg-banner px-3 py-2.5 text-xs text-banner-ink'
)

/** フォルダの印の色。登録順に繰り返して使う */
const folderDots = ['bg-dot-sand', 'bg-leaf', 'bg-dot-sky', 'bg-dot-rose']

/**
 * サイドバーで表示範囲を切り替えるボタン。
 * @param props.icon 先頭の印
 * @param props.count 写真の枚数
 * @param props.warning 枚数の前に添える注意。なければ添えない
 * @param props.active 選択中の表示範囲か
 * @param props.onClick 押されたときに呼ばれる
 * @param props.children 表示範囲の名前
 * @returns ボタンの React 要素
 */
const NavItem = ({ icon, count, warning, active, onClick, children }: {
  icon: ReactNode
  count: number
  warning?: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) => (
  <button
    className={(
      'flex w-full items-center gap-2.5 rounded-[7px] p-[9px] text-left text-xs ' +
      (active ? 'bg-sidebar-active text-white' : 'text-sidebar-text')
    )}
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
  >
    <span className={`w-[13px] flex-none text-center text-base ${active ? 'text-leaf-bright' : 'text-sidebar-icon'}`}>
      {icon}
    </span>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {warning && <small className="flex-none text-[9px] text-caution">{warning}</small>}
    <b className="flex-none font-mono text-[10px] font-normal text-sidebar-dim">{count}</b>
  </button>
)

/**
 * 写真の一覧の代わりに出す案内。
 * @param props.icon 見出しの上に出す印。なければ出さない
 * @param props.title 見出し
 * @param props.children 見出しの下に添える説明や操作
 * @returns 案内の React 要素
 */
const EmptyState = ({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) => (
  <div className="py-16 text-center text-xs text-[#768077] sm:py-24">
    {icon && <span className="text-[34px]">{icon}</span>}
    <h2 className="mt-3 mb-1 text-[17px] font-bold text-[#3d4c45]">{title}</h2>
    {children}
  </div>
)

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
  openStore: () => Promise<LibraryStore>
  makeThumbnail?: ThumbnailMaker
}) => {
  const library = useLibrary(source, openStore)
  const { folders, permissions, scan } = library
  const [view, setView] = useState<View>({ kind: 'all' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 狭い画面でサイドバー・詳細表示を開いているか。広い画面では常に表示するため使わない
  const [navOpen, setNavOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)

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

  /** 重ねて開いているサイドバーと詳細表示を閉じる。 */
  const closeDrawers = () => {
    setNavOpen(false)
    setInspectorOpen(false)
  }

  useEffect(() => {
    if (!navOpen && !inspectorOpen) return
    /**
     * Esc キーで重ねて開いているものを閉じる。
     * @param event キーボードのイベント
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawers()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navOpen, inspectorOpen])

  /**
   * 表示範囲を切り替え、写真の選択を解除する。狭い画面ではサイドバーを閉じる。
   * @param next 新しい表示範囲
   */
  const chooseView = (next: View) => {
    setView(next)
    setSelectedId(null)
    setNavOpen(false)
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
   * 写真を選び、狭い画面では詳細表示を開く。
   * @param photoId 選んだ写真の ID
   */
  const selectPhoto = (photoId: string) => {
    setSelectedId(photoId)
    setInspectorOpen(true)
  }

  /**
   * 写真の一覧を描画する。表示する写真がなければ、状況に応じた案内を出す。
   * @returns 写真の一覧または案内の React 要素
   */
  const renderPhotos = () => {
    if (library.status === 'loading') return <EmptyState title="ライブラリを読み込み中…" />
    if (visiblePhotos.length) {
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[18px] gap-y-6">
          {visiblePhotos.map((photo) => (
            <PhotoCard
              key={photo.id}
              source={source}
              thumbnails={library.thumbnails}
              makeThumbnail={makeThumbnail}
              photo={photo}
              accessible={isAccessible(photo)}
              selected={selectedPhoto?.id === photo.id}
              onSelect={selectPhoto}
              onUnavailable={library.reportUnavailable}
            />
          ))}
        </div>
      )
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
    if (view.kind === 'missing') return <EmptyState icon="⌁" title="再接続が必要な写真はありません" />
    return (
      <EmptyState icon="▦" title="表示できる写真がありません">
        <p>対応している形式は JPEG、PNG、GIF、WebP、AVIF、BMP です。</p>
      </EmptyState>
    )
  }

  /**
   * 選択中の写真の詳細を描画する。
   * @returns 詳細表示、または写真を選ぶよう促す案内の React 要素
   */
  const renderInspector = () => {
    if (!selectedPhoto) {
      return <p className="mt-10 text-center text-xs text-muted">写真を選ぶと、ここに詳細を表示します。</p>
    }
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
    <main className="h-dvh lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[235px_minmax(0,1fr)_294px]">
      <aside
        className={(
          'fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col overflow-y-auto bg-sidebar px-[18px] pt-7 pb-[18px] ' +
          'text-[#e9f0e9] transition-[translate,visibility] duration-200 lg:visible lg:static lg:z-auto lg:w-auto ' +
          `lg:translate-x-0 ${navOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`
        )}
        data-open={navOpen}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[9px] px-2.5 text-xl font-extrabold tracking-[-1px]">
            <span className="-rotate-25 font-serif text-[27px] text-[#a7d276]">⌁</span><span>snapnest</span>
          </div>
          <button
            className="px-2 text-xl text-sidebar-icon lg:hidden"
            aria-label="メニューを閉じる"
            onClick={() => setNavOpen(false)}
          >
            ×
          </button>
        </div>
        <button
          className={`${folderButton} mt-7 w-full`}
          disabled={library.status !== 'ready' || !!scan}
          onClick={library.addFolder}
        >
          <span>＋</span> フォルダを開く
        </button>
        <nav className="mt-[30px]">
          <p className={navLabel}>ライブラリ</p>
          <NavItem
            icon="▦"
            count={library.photos.length}
            active={isActive({ kind: 'all' })}
            onClick={() => chooseView({ kind: 'all' })}
          >
            すべての写真
          </NavItem>
          <NavItem
            icon="⌁"
            count={missingCount}
            active={isActive({ kind: 'missing' })}
            onClick={() => chooseView({ kind: 'missing' })}
          >
            再接続が必要
          </NavItem>
          <p className={`${navLabel} mt-[25px]`}>フォルダ</p>
          {folders.length === 0 && <p className="mx-[9px] text-[11px] text-sidebar-dim">まだフォルダがありません</p>}
          {folders.map((folder, index) => (
            <NavItem
              key={folder.id}
              icon={<span className={`inline-block size-1.5 rounded-full ${folderDots[index % folderDots.length]}`} />}
              count={countsByFolder.get(folder.id) ?? 0}
              warning={permissions[folder.id] !== 'granted' ? '要許可' : undefined}
              active={isActive({ kind: 'folder', folderId: folder.id })}
              onClick={() => chooseView({ kind: 'folder', folderId: folder.id })}
            >
              {folder.name}
            </NavItem>
          ))}
        </nav>
        <div className="mt-auto p-2.5 pt-8 text-[11px] text-sidebar-icon">
          <p>
            <span
              className={`mr-[7px] inline-block size-1.5 rounded-full ${library.persistent ? 'bg-leaf' : 'bg-caution'}`}
            />
            {footerStatus()}
          </p>
          <p className="mt-2 text-[9px] leading-relaxed text-sidebar-dim">
            ブラウザのサイトデータを削除したりシークレットモードで開いたりすると、
            登録したフォルダや写真の情報、サムネイルは失われます。写真の原本は消えません。
          </p>
        </div>
      </aside>

      <section className="h-full overflow-y-auto px-4 pt-6 pb-8 sm:px-7 lg:px-10 lg:pt-9">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="flex-none rounded-lg border border-line bg-white px-2.5 py-1.5 text-slate lg:hidden"
              aria-label="メニューを開く"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              ☰
            </button>
            <div className="min-w-0">
              <p className="mb-[3px] text-[11px] text-muted">{currentFolder ? 'フォルダ' : 'ライブラリ'}</p>
              <h1 className="truncate text-2xl font-bold tracking-[-1.2px] text-ink-strong sm:text-[28px]">{title}</h1>
            </div>
          </div>
          {currentFolder && (
            <button
              className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-slate"
              disabled={!!scan}
              onClick={() => library.rescan(currentFolder.id)}
            >
              ↻ 再読み込み
            </button>
          )}
        </header>

        {!source.supported && (
          <div className={banner} role="alert">
            このブラウザはフォルダの参照に対応していません。snapnest は現在 Chrome を対象にしています。
          </div>
        )}
        {foldersNeedingAccess.map((folder) => (
          <div key={folder.id} className={banner}>
            <span>
              「{folder.name}」へのアクセス許可が必要です。
              {permissions[folder.id] === 'denied' ? 'アクセスが拒否されています。' : ''}
            </span>
            <button
              className="flex-none rounded-md bg-banner-ink px-2.5 py-1.5 text-[11px] font-bold text-white"
              onClick={() => library.requestAccess(folder.id)}
            >
              アクセスを許可
            </button>
          </div>
        ))}

        <div className="mt-8 mb-[17px] text-xs text-[#66736b] lg:mt-[39px]">
          {library.status === 'ready' ? `${visiblePhotos.length} 枚` : ''}
        </div>
        {renderPhotos()}
      </section>

      <aside
        className={(
          'inspector fixed inset-y-0 right-0 z-30 w-full max-w-sm overflow-y-auto bg-panel px-[22px] py-6 shadow-xl ' +
          'transition-[translate,visibility] duration-200 xl:visible xl:static xl:z-auto xl:max-w-none ' +
          'xl:translate-x-0 xl:border-l xl:border-[#e2e0d9] xl:py-8 xl:shadow-none ' +
          (inspectorOpen ? 'visible translate-x-0' : 'invisible translate-x-full')
        )}
        aria-label="写真の詳細"
        data-open={inspectorOpen}
      >
        <div className="mb-3 flex justify-end xl:hidden">
          <button className="px-2 text-xl text-muted" aria-label="詳細を閉じる" onClick={() => setInspectorOpen(false)}>
            ×
          </button>
        </div>
        {renderInspector()}
      </aside>
      {(navOpen || inspectorOpen) && (
        <div
          className={`fixed inset-0 z-20 bg-ink/30 ${navOpen ? 'lg:hidden' : 'xl:hidden'}`}
          aria-hidden="true"
          onClick={closeDrawers}
        />
      )}
      {library.notice && (
        <div
          className={(
            'fixed bottom-6 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg bg-toast ' +
            'px-[15px] py-3 text-xs text-white shadow-[0_8px_20px_#0003]'
          )}
          role="status"
        >
          {library.notice}
          <button className="ml-3.5 text-base text-[#d1ded4]" aria-label="通知を閉じる" onClick={library.dismissNotice}>
            ×
          </button>
        </div>
      )}
    </main>
  )
}
