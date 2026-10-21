import { useState } from 'react'
import type { FolderRecord, PhotoRecord } from '../db/libraryStore'
import type { PhotoSource, UnavailableReason } from '../fs/photoSource'
import { formatBytes, formatDate, formatDirectory, formatKind } from '../library/format'
import { PhotoImageView } from './PhotoCard'

/**
 * 保存場所の下に添える、原本を参照できるかの説明。
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @returns 説明の React 要素
 */
const LocationStatus = ({ photo, accessible }: { photo: PhotoRecord; accessible: boolean }) => {
  if (photo.status === 'missing') {
    return <small className="warning">ファイルが見つかりません。移動・改名・削除された可能性があります。</small>
  }
  if (!accessible) return <small className="warning">フォルダへのアクセス許可が必要です。</small>
  return <small>ローカルのフォルダを参照中</small>
}

/**
 * 選択中の写真の詳細表示。写真を切り替えるときは `key` を変えて状態を作り直す。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.photo 表示する写真
 * @param props.folder 写真が入っているフォルダ
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.scanning フォルダの読み込み中か
 * @param props.onUnavailable 原本を読めなかったときに呼ばれる
 * @param props.onRequestAccess アクセスの許可を求めるときに呼ばれる
 * @param props.onRescan フォルダを読み込み直すときに呼ばれる
 * @returns 詳細表示の React 要素
 */
export const Inspector = ({ source, photo, folder, accessible, scanning, onUnavailable, onRequestAccess, onRescan }: {
  source: PhotoSource
  photo: PhotoRecord
  folder: FolderRecord | undefined
  accessible: boolean
  scanning: boolean
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
  onRequestAccess: (folderId: string) => void
  onRescan: (folderId: string) => void
}) => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const directory = formatDirectory(photo.relativePath)
  const location = [folder?.name ?? '不明なフォルダ', directory].filter(Boolean).join(' / ')

  return <>
    <PhotoImageView
      source={source}
      photo={photo}
      accessible={accessible}
      className="inspector-image"
      onUnavailable={onUnavailable}
      onLoad={(width, height) => setDimensions({ width, height })}
    />
    <div className="inspector-heading">
      <div><h2 title={photo.name}>{photo.name}</h2><p>{formatDate(photo.lastModified)} 更新</p></div>
    </div>
    <section className="detail-section">
      <p>保存場所</p>
      <div className="path">
        <span>▣</span>
        <div>
          <strong>{location}</strong>
          <LocationStatus photo={photo} accessible={accessible} />
        </div>
      </div>
      {folder && photo.status === 'missing' && (
        <button className="detail-action" disabled={scanning} onClick={() => onRescan(folder.id)}>
          フォルダを再読み込み
        </button>
      )}
      {folder && photo.status !== 'missing' && !accessible && (
        <button className="detail-action" onClick={() => onRequestAccess(folder.id)}>アクセスを許可</button>
      )}
    </section>
    <section className="detail-section">
      <p>詳細</p>
      <dl>
        <div><dt>形式</dt><dd>{formatKind(photo.name)} · {formatBytes(photo.size)}</dd></div>
        <div>
          <dt>サイズ</dt>
          <dd>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : '—'}</dd>
        </div>
      </dl>
    </section>
    <p className="privacy-note">
      この写真は端末内にあります。snapnest は原本をコピー・アップロードしません。
    </p>
  </>
}
