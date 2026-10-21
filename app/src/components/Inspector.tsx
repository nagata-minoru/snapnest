import { useState } from 'react'
import type { CollectionRecord, FolderRecord, PhotoRecord, ThumbnailCache } from '../db/libraryStore'
import type { PhotoSource, UnavailableReason } from '../fs/photoSource'
import { formatBytes, formatDate, formatDirectory, formatKind } from '../library/format'
import type { ReconnectCandidate } from '../library/reconnect'
import { PhotoImageView } from './PhotoCard'
import { PhotoCollections } from './PhotoCollections'
import { ReconnectCandidates } from './ReconnectCandidates'
import { noThumbnail } from '../thumbnails/thumbnailMaker'
import { usePhotoUrl, useThumbnailUrl } from './usePhotoUrl'

/** 写真が端末内にあることを伝える案内 */
const localNote = 'この写真は端末内にあります。snapnest は原本をコピー・アップロードしません。'

/** 見つからない写真の原本を開けない理由を伝える案内 */
const missingNote = 'snapnest は原本をコピーしていないため、元のファイルが見つかるまで原本を開けません。'

/** 保存場所の下に添える説明の見た目 */
const note = 'mt-0.5 block text-[9px] text-[#8a918b]'

/** 原本を参照できないときの説明の見た目 */
const warning = 'mt-0.5 block text-[9px] text-warning-ink'

/** 詳細表示の区切りの見た目 */
const section = 'border-b border-panel-line py-[18px]'

/** 区切りの見出しの見た目 */
const sectionLabel = 'mb-2.5 text-[10px] text-muted'

/** 写真に対する操作ボタンの見た目 */
const action = 'mt-2.5 rounded-md border border-[#c8c6bc] bg-white px-2.5 py-1.5 text-[11px] text-[#45534c]'

/** 詳細の項目 1 行分の見た目 */
const detailRow = 'flex justify-between py-[5px] text-[10px]'

/**
 * 保存場所の下に添える、原本を参照できるかの説明。
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @returns 説明の React 要素
 */
const LocationStatus = ({ photo, accessible }: { photo: PhotoRecord; accessible: boolean }) => {
  if (photo.status === 'missing') {
    return <small className={warning}>ファイルが見つかりません。移動・改名・削除された可能性があります。</small>
  }
  if (!accessible) return <small className={warning}>フォルダへのアクセス許可が必要です。</small>
  return <small className={note}>ローカルのフォルダを参照中</small>
}

/**
 * 選択中の写真の詳細表示。写真を切り替えるときは `key` を変えて状態を作り直す。
 * 原本を表示し、読めないとき（参照切れ・権限なし）は保存済みのサムネイルで代える。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.thumbnails サムネイルのキャッシュ
 * @param props.photo 表示する写真
 * @param props.folder 写真が入っているフォルダ
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.scanning フォルダの読み込み中か
 * @param props.onUnavailable 原本を読めなかったときに呼ばれる
 * @param props.onRequestAccess アクセスの許可を求めるときに呼ばれる
 * @param props.onRescan フォルダを読み込み直すときに呼ばれる
 * @param props.collections すべてのコレクション。表示する順に並べる
 * @param props.memberOf 写真が入っているコレクションの ID
 * @param props.onAddToCollection 写真をコレクションに入れるときに呼ばれる
 * @param props.onRemoveFromCollection 写真をコレクションから外すときに呼ばれる
 * @param props.onCreateCollection 新しいコレクションを作るときに呼ばれる
 * @param props.candidates 見つからない写真につなぎ直す候補
 * @param props.locationOf 写真の保存場所を表す文を返す
 * @param props.isAccessible 写真のフォルダへのアクセスが許可されているかを返す
 * @param props.onReconnect 見つからない写真を候補につなぎ直すときに呼ばれる。つなぎ直せたら `true` を返す
 * @param props.onRemovePhoto 写真の記録をライブラリから外すときに呼ばれる。外せたら `true` を返す
 * @returns 詳細表示の React 要素
 */
export const Inspector = ({
  source, thumbnails, photo, folder, accessible, scanning, onUnavailable, onRequestAccess, onRescan,
  collections, memberOf, onAddToCollection, onRemoveFromCollection, onCreateCollection,
  candidates, locationOf, isAccessible, onReconnect, onRemovePhoto,
}: {
  source: PhotoSource
  thumbnails: ThumbnailCache
  photo: PhotoRecord
  folder: FolderRecord | undefined
  accessible: boolean
  scanning: boolean
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
  onRequestAccess: (folderId: string) => void
  onRescan: (folderId: string) => void
  collections: readonly CollectionRecord[]
  memberOf: ReadonlySet<string>
  onAddToCollection: (collectionId: string, photoId: string) => Promise<void>
  onRemoveFromCollection: (collectionId: string, photoId: string) => Promise<void>
  onCreateCollection: (name: string) => Promise<CollectionRecord | null>
  candidates: readonly ReconnectCandidate[]
  locationOf: (photo: PhotoRecord) => string
  isAccessible: (photo: PhotoRecord) => boolean
  onReconnect: (missingId: string, targetId: string) => Promise<boolean>
  onRemovePhoto: (photoId: string) => Promise<boolean>
}) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const readable = accessible && photo.status === 'available'
  const original = usePhotoUrl(source, photo, readable, onUnavailable)
  // 原本を読めないときだけ、保存済みのサムネイルを探す。ここでは新しく作らない
  const cached = useThumbnailUrl({
    source, cache: thumbnails, makeThumbnail: noThumbnail, photo, enabled: !readable, readable: false, onUnavailable,
  })
  const location = [folder?.name ?? '不明なフォルダ', formatDirectory(photo.relativePath)].filter(Boolean).join(' / ')

  return <>
    <PhotoImageView
      photo={photo}
      accessible={accessible}
      image={readable ? original : cached}
      fit="contain"
      className="aspect-[1.14]"
      onLoad={(width, height) => {
        // サムネイルの大きさは原本の大きさではないため表示しない
        if (readable) setDimensions({ width, height })
      }}
    />
    <div className="border-b border-panel-line pt-[17px] pb-5">
      <h2 className="truncate text-base font-bold tracking-[-.5px]" title={photo.name}>{photo.name}</h2>
      <p className="mt-[3px] text-[10px] text-muted">{formatDate(photo.lastModified)} 更新</p>
    </div>
    <section className={section}>
      <p className={sectionLabel}>保存場所</p>
      <div className="flex items-center gap-[9px]">
        <span className="text-[17px] text-[#7da67a]">▣</span>
        <div className="min-w-0">
          <strong className="block text-[11px] break-all">{location}</strong>
          <LocationStatus photo={photo} accessible={accessible} />
        </div>
      </div>
      {folder && photo.status === 'missing' && (
        <button className={action} disabled={scanning} onClick={() => onRescan(folder.id)}>
          フォルダを再読み込み
        </button>
      )}
      {folder && photo.status !== 'missing' && !accessible && (
        <button className={action} onClick={() => onRequestAccess(folder.id)}>アクセスを許可</button>
      )}
    </section>
    {photo.status === 'missing' && (
      <section className={section}>
        <p className={sectionLabel}>再接続の候補</p>
        <ReconnectCandidates
          source={source}
          thumbnails={thumbnails}
          photo={photo}
          candidates={candidates}
          locationOf={locationOf}
          isAccessible={isAccessible}
          onUnavailable={onUnavailable}
          onReconnect={(targetId) => onReconnect(photo.id, targetId)}
          onRemove={() => onRemovePhoto(photo.id)}
        />
      </section>
    )}
    <section className={section}>
      <p className={sectionLabel}>コレクション</p>
      <PhotoCollections
        collections={collections}
        memberOf={memberOf}
        onAdd={(collectionId) => onAddToCollection(collectionId, photo.id)}
        onRemove={(collectionId) => onRemoveFromCollection(collectionId, photo.id)}
        onCreate={onCreateCollection}
      />
    </section>
    <section className={section}>
      <p className={sectionLabel}>詳細</p>
      <dl className="text-[#47534d] [&_dt]:text-muted">
        <div className={detailRow}><dt>形式</dt><dd>{formatKind(photo.name)} · {formatBytes(photo.size)}</dd></div>
        <div className={detailRow}>
          <dt>サイズ</dt>
          <dd>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : '—'}</dd>
        </div>
      </dl>
    </section>
    <p className="mt-[18px] rounded-md bg-note p-2.5 text-[9px] leading-relaxed text-note-ink">
      {photo.status === 'missing' ? missingNote : localNote}
    </p>
  </>
}
