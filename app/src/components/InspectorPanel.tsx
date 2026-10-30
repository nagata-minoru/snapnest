import type { PhotoRecord } from '../db/libraryStore'
import type { PhotoSource } from '../fs/photoSource'
import { formatLocation } from '../library/format'
import type { ReconnectCandidate } from '../library/reconnect'
import type { Library } from '../library/useLibrary'
import type { LibraryIndex } from '../library/useLibraryIndex'
import { Inspector } from './Inspector'

/** どのコレクションにも入っていない写真の所属先 */
const noMembers: ReadonlySet<string> = new Set()

/** 再接続の候補がない写真の候補 */
const noCandidates: readonly ReconnectCandidate[] = []

/**
 * 選択中の写真の詳細を出す枠。狭い画面では、開いているときだけ右から重ねて表示する。
 * @param props.library ライブラリの状態と操作
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.open 狭い画面で開いているか
 * @param props.onClose 閉じるボタンが押されたときに呼ばれる
 * @param props.photo 選択中の写真。選んでいなければ `undefined`
 * @param props.index 並べ替えたコレクション、所属関係、再接続の候補
 * @param props.onSelect 写真を選び直すときに呼ばれる
 * @returns 詳細表示の枠の React 要素
 */
export const InspectorPanel = ({
  library, source, open, onClose, photo, index, onSelect,
}: {
  library: Library
  source: PhotoSource
  open: boolean
  onClose: () => void
  photo: PhotoRecord | undefined
  index: LibraryIndex
  onSelect: (photoId: string) => void
}) => {
  const { folderNames, sortedCollections, collectionsByPhoto, candidatesByPhoto, isAccessible } = index

  /**
   * 写真の保存場所を、フォルダ名と相対パスで表す。
   * @param target 写真
   * @returns 「Pictures / trip / station.png」のような文
   */
  const locationOf = (target: PhotoRecord) => formatLocation(folderNames.get(target.folderId), target.relativePath)

  /**
   * 見つからない写真をつなぎ直し、つなぎ直せたら移動先の写真を選ぶ。
   * @param missingId 見つからない写真の ID
   * @param targetId つなぎ直す先の写真の ID
   * @returns つなぎ直せたら `true`
   */
  const reconnect = async (missingId: string, targetId: string) => {
    const done = await library.reconnectPhoto(missingId, targetId)
    if (done) onSelect(targetId)
    return done
  }

  return (
    <aside
      className={(
        'inspector fixed inset-y-0 right-0 z-30 w-full max-w-sm overflow-y-auto bg-panel px-[22px] py-6 shadow-xl ' +
        'transition-[translate,visibility] duration-200 xl:visible xl:static xl:z-auto xl:max-w-none ' +
        'xl:translate-x-0 xl:border-l xl:border-[#e2e0d9] xl:py-8 xl:shadow-none ' +
        (open ? 'visible translate-x-0' : 'invisible translate-x-full')
      )}
      aria-label="写真の詳細"
      data-open={open}
    >
      <div className="mb-3 flex justify-end xl:hidden">
        <button className="px-2 text-xl text-muted" aria-label="詳細を閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      {!photo && <p className="mt-10 text-center text-xs text-muted">写真を選ぶと、ここに詳細を表示します。</p>}
      {photo && (
        <Inspector
          key={photo.id}
          source={source}
          thumbnails={library.thumbnails}
          photo={photo}
          folder={library.folders.find((folder) => folder.id === photo.folderId)}
          accessible={isAccessible(photo)}
          scanning={!!library.scan}
          onUnavailable={library.reportUnavailable}
          onRequestAccess={library.requestAccess}
          onRescan={library.rescan}
          collections={sortedCollections}
          memberOf={collectionsByPhoto.get(photo.id) ?? noMembers}
          onAddToCollection={library.addToCollection}
          onRemoveFromCollection={library.removeFromCollection}
          onCreateCollection={library.createCollection}
          candidates={candidatesByPhoto.get(photo.id) ?? noCandidates}
          locationOf={locationOf}
          isAccessible={isAccessible}
          onReconnect={reconnect}
          onRemovePhoto={library.removePhoto}
        />
      )}
    </aside>
  )
}
