import { useState, type ReactNode } from 'react'
import type { SourceSupport } from '../fs/photoSource'
import type { Library } from '../library/useLibrary'
import type { LibraryIndex } from '../library/useLibraryIndex'
import { viewKey, type View } from '../library/view'
import { CollectionNameForm } from './CollectionNameForm'
import { folderButton } from './styles'

/** サイドバーの見出しの見た目 */
const navLabel = 'mx-[9px] mb-[9px] text-[10px] font-bold tracking-widest text-sidebar-dim'

/** フォルダの印の色。登録順に繰り返して使う */
const folderDots = ['bg-dot-sand', 'bg-leaf', 'bg-dot-sky', 'bg-dot-rose']

/** ブラウザが保持を約束していなければ、容量不足のときに保存した情報が消されることがある */
const evictionWarning = '端末の空き容量が少なくなったときも、ブラウザが自動で消すことがあります。'

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
 * 表示範囲を選ぶサイドバー。フォルダを開くボタン、ライブラリ・コレクション・フォルダの一覧、保存の状態を出す。
 * 狭い画面では、開いているときだけ左から重ねて表示する。
 * @param props.library ライブラリの状態と操作
 * @param props.support フォルダを開けるかどうか
 * @param props.open 狭い画面で開いているか
 * @param props.onClose 閉じるボタンが押されたときに呼ばれる
 * @param props.saving 登録内容を保存できているか
 * @param props.view 表示中の範囲
 * @param props.onChooseView 表示範囲が選ばれたときに呼ばれる
 * @param props.index 並べ替えたコレクションと、各種の枚数
 * @returns サイドバーの React 要素
 */
export const Sidebar = ({
  library, support, open, onClose, saving, view, onChooseView, index,
}: {
  library: Library
  support: SourceSupport
  open: boolean
  onClose: () => void
  saving: boolean
  view: View
  onChooseView: (view: View) => void
  index: LibraryIndex
}) => {
  const { folders, permissions, scan } = library
  const { sortedCollections, photosByCollection, countsByFolder, missingCount, withCandidatesCount } = index
  const [creatingCollection, setCreatingCollection] = useState(false)

  /**
   * 表示範囲が選択中のものか判定する。
   * @param target 調べる表示範囲
   * @returns 選択中なら `true`
   */
  const isActive = (target: View) => viewKey(target) === viewKey(view)

  /**
   * 新しいコレクションを作る。作れたら入力欄を閉じ、そのコレクションを表示する。
   * @param name コレクション名
   */
  const createCollection = async (name: string) => {
    const created = await library.createCollection(name)
    if (!created) return
    setCreatingCollection(false)
    onChooseView({ kind: 'collection', collectionId: created.id })
  }

  /**
   * 下部に出す状態の説明を作る。
   * @returns 読み込みの進み具合、または保存の状態を表す文
   */
  const footerStatus = () => {
    const scanningFolder = scan && folders.find((folder) => folder.id === scan.folderId)
    if (scan && scanningFolder) return `「${scanningFolder.name}」を読み込み中… ${scan.found} 枚`
    if (saving) return '端末内のフォルダを参照中'
    return '登録内容は保存されません'
  }

  return (
    <aside
      className={(
        'fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col overflow-y-auto bg-sidebar px-[18px] pt-7 pb-[18px] ' +
        'text-[#e9f0e9] transition-[translate,visibility] duration-200 lg:visible lg:static lg:z-auto lg:w-auto ' +
        `lg:translate-x-0 ${open ? 'visible translate-x-0' : 'invisible -translate-x-full'}`
      )}
      data-open={open}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[9px] px-2.5 text-xl font-extrabold tracking-[-1px]">
          <span className="-rotate-25 font-serif text-[27px] text-[#a7d276]">⌁</span><span>snapnest</span>
        </div>
        <button className="px-2 text-xl text-sidebar-icon lg:hidden" aria-label="メニューを閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <button
        className={`${folderButton} mt-7 w-full`}
        disabled={library.status !== 'ready' || !!scan || support !== 'supported'}
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
          onClick={() => onChooseView({ kind: 'all' })}
        >
          すべての写真
        </NavItem>
        <NavItem
          icon="⌁"
          count={missingCount}
          warning={withCandidatesCount ? '候補あり' : undefined}
          active={isActive({ kind: 'missing' })}
          onClick={() => onChooseView({ kind: 'missing' })}
        >
          再接続が必要
        </NavItem>
        <div className="mt-[25px] mb-[9px] flex items-center justify-between">
          <p className={`${navLabel} mb-0`}>コレクション</p>
          <button
            className="mr-[5px] px-1 text-sm leading-none text-sidebar-icon"
            aria-label="コレクションを作る"
            aria-expanded={creatingCollection}
            disabled={library.status !== 'ready'}
            onClick={() => setCreatingCollection(!creatingCollection)}
          >
            ＋
          </button>
        </div>
        {creatingCollection && (
          <div className="mx-[9px] mb-2">
            <CollectionNameForm
              label="コレクション名"
              submitLabel="作成"
              tone="dark"
              collections={library.collections}
              onSubmit={createCollection}
              onCancel={() => setCreatingCollection(false)}
            />
          </div>
        )}
        {sortedCollections.length === 0 && !creatingCollection && (
          <p className="mx-[9px] text-[11px] text-sidebar-dim">まだコレクションがありません</p>
        )}
        {sortedCollections.map((collection) => (
          <NavItem
            key={collection.id}
            icon="◇"
            count={photosByCollection.get(collection.id)?.size ?? 0}
            active={isActive({ kind: 'collection', collectionId: collection.id })}
            onClick={() => onChooseView({ kind: 'collection', collectionId: collection.id })}
          >
            {collection.name}
          </NavItem>
        ))}
        <p className={`${navLabel} mt-[25px]`}>フォルダ</p>
        {folders.length === 0 && <p className="mx-[9px] text-[11px] text-sidebar-dim">まだフォルダがありません</p>}
        {folders.map((folder, index) => (
          <NavItem
            key={folder.id}
            icon={<span className={`inline-block size-1.5 rounded-full ${folderDots[index % folderDots.length]}`} />}
            count={countsByFolder.get(folder.id) ?? 0}
            warning={permissions[folder.id] !== 'granted' ? '要許可' : undefined}
            active={isActive({ kind: 'folder', folderId: folder.id })}
            onClick={() => onChooseView({ kind: 'folder', folderId: folder.id })}
          >
            {folder.name}
          </NavItem>
        ))}
      </nav>
      <div className="mt-auto p-2.5 pt-8 text-[11px] text-sidebar-icon">
        <p>
          <span className={`mr-[7px] inline-block size-1.5 rounded-full ${saving ? 'bg-leaf' : 'bg-caution'}`} />
          {footerStatus()}
        </p>
        <p className="mt-2 text-[9px] leading-relaxed text-sidebar-dim">
          ブラウザのサイトデータを削除したりシークレットモードで開いたりすると、
          登録したフォルダや写真の情報、サムネイルは失われます。
          {saving && !library.storagePersisted && evictionWarning}
          写真の原本は消えません。
        </p>
      </div>
    </aside>
  )
}
