import { useRef, useState } from 'react'
import type { PhotoRecord } from '../db/libraryStore'
import type { PhotoSource, UnavailableReason } from '../fs/photoSource'
import { formatShortDate } from '../library/format'
import { useNearViewport, usePhotoUrl, type PhotoImage } from './usePhotoUrl'

/**
 * 写真の画像に重ねて表示する状態の文言を決める。
 * @param photo 写真
 * @param accessible フォルダへのアクセスが許可されているか
 * @param image 画像の読み込み状態
 * @param broken 画像を読めたが表示できなかったか
 * @returns 状態の文言。問題がなければ `null`
 */
export const photoStateLabel = (photo: PhotoRecord, accessible: boolean, image: PhotoImage, broken: boolean) => {
  if (photo.status === 'missing') return '見つかりません'
  if (!accessible) return 'アクセス許可が必要'
  if (image.status === 'failed' || broken) return '表示できません'
  return null
}

/**
 * 写真の原本を読み込んで表示する画像。読めない場合は状態を表示する。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.active 読み込むかどうか。画面から離れているときなどは `false`
 * @param props.className 外枠に付けるクラス名
 * @param props.onUnavailable 読めなかったときに呼ばれる
 * @param props.onLoad 画像を表示できたときに、画像の幅と高さを引数に呼ばれる
 * @returns 画像の React 要素
 */
export const PhotoImageView = ({ source, photo, accessible, active = true, className = '', onUnavailable, onLoad }: {
  source: PhotoSource
  photo: PhotoRecord
  accessible: boolean
  active?: boolean
  className?: string
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
  onLoad?: (width: number, height: number) => void
}) => {
  const image = usePhotoUrl(source, photo, active && accessible && photo.status === 'available', onUnavailable)
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const broken = image.status === 'ready' && image.url === brokenUrl
  const label = photoStateLabel(photo, accessible, image, broken)

  return (
    <div className={`thumbnail ${image.status} ${className}`}>
      {image.status === 'ready' && !broken && (
        <img
          src={image.url}
          alt=""
          decoding="async"
          onLoad={(event) => onLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          onError={() => setBrokenUrl(image.url)}
        />
      )}
      {label && <span className="thumbnail-state">{label}</span>}
    </div>
  )
}

/**
 * 写真一覧の 1 枚分のカード。画面の近くにある間だけ原本を読み込む。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.selected 選択中か
 * @param props.onSelect 選ばれたときに呼ばれる
 * @param props.onUnavailable 原本を読めなかったときに呼ばれる
 * @returns カードの React 要素
 */
export const PhotoCard = ({ source, photo, accessible, selected, onSelect, onUnavailable }: {
  source: PhotoSource
  photo: PhotoRecord
  accessible: boolean
  selected: boolean
  onSelect: (photoId: string) => void
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
}) => {
  const card = useRef<HTMLButtonElement>(null)
  const near = useNearViewport(card)

  return (
    <button
      ref={card}
      className={`photo-card ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(photo.id)}
    >
      <PhotoImageView
        source={source}
        photo={photo}
        accessible={accessible}
        active={near}
        onUnavailable={onUnavailable}
      />
      <span className="selection">✓</span>
      <span className="photo-caption">
        <strong title={photo.relativePath}>{photo.name}</strong>
        <span>{formatShortDate(photo.lastModified)}</span>
      </span>
    </button>
  )
}
