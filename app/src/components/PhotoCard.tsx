import { useRef, useState } from 'react'
import type { PhotoRecord, ThumbnailCache } from '../db/libraryStore'
import type { PhotoSource, UnavailableReason } from '../fs/photoSource'
import { formatShortDate } from '../library/format'
import type { ThumbnailMaker } from '../thumbnails/thumbnailMaker'
import { useNearViewport, useThumbnailUrl, type PhotoImage } from './usePhotoUrl'

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

/** 画像がないときに、枠全体に出す状態の見た目。`thumbnail-state` はテストで探す目印 */
const stateCover = (
  'thumbnail-state absolute inset-0 grid place-items-center bg-state p-2 text-center text-[11px] text-state-ink'
)

/** 画像に重ねて隅に出す状態の見た目。`badge` はテストで重ねた状態を探す目印 */
const stateBadge = (
  'thumbnail-state badge absolute bottom-2 left-2 rounded-[5px] bg-state/92 px-[7px] py-[3px] ' +
  'text-[11px] text-state-ink'
)

/**
 * 写真の画像を表示する。問題があれば状態を重ねて表示する。
 * 画像がなければ状態だけを全面に、画像があれば隅に小さく表示する。
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.image 画像の読み込み状態
 * @param props.fit 画像を枠いっぱいに切り抜くか（`cover`）、全体を収めるか（`contain`）
 * @param props.className 外枠に付けるクラス名。枠の縦横比などを指定する
 * @param props.onLoad 画像を表示できたときに、画像の幅と高さを引数に呼ばれる
 * @returns 画像の React 要素
 */
export const PhotoImageView = ({ photo, accessible, image, fit = 'cover', className = '', onLoad }: {
  photo: PhotoRecord
  accessible: boolean
  image: PhotoImage
  fit?: 'cover' | 'contain'
  className?: string
  onLoad?: (width: number, height: number) => void
}) => {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const broken = image.status === 'ready' && image.url === brokenUrl
  const label = photoStateLabel(photo, accessible, image, broken)
  const shown = image.status === 'ready' && !broken
  const loading = image.status === 'loading'

  return (
    <div className={`relative isolate overflow-hidden rounded-lg bg-tile ${loading ? 'shimmer' : ''} ${className}`}>
      {shown && (
        <img
          className={`absolute inset-0 size-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
          src={image.url}
          alt=""
          decoding="async"
          onLoad={(event) => onLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          onError={() => setBrokenUrl(image.url)}
        />
      )}
      {label && <span className={shown ? stateBadge : stateCover}>{label}</span>}
    </div>
  )
}

/** 選択中のカードの画像を囲む線 */
const selectedOutline = (
  'group-aria-pressed:outline-3 group-aria-pressed:outline-offset-3 group-aria-pressed:outline-accent'
)

/**
 * 写真一覧の 1 枚分のカード。画面の近くにある間だけサムネイルを用意する。
 * `photo-card` クラスはテストでカードを探す目印。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.thumbnails サムネイルのキャッシュ
 * @param props.makeThumbnail 原本からサムネイルを作る関数
 * @param props.photo 表示する写真
 * @param props.accessible フォルダへのアクセスが許可されているか
 * @param props.selected 選択中か
 * @param props.onSelect 選ばれたときに呼ばれる
 * @param props.onUnavailable 原本を読めなかったときに呼ばれる
 * @returns カードの React 要素
 */
export const PhotoCard = ({ source, thumbnails, makeThumbnail, photo, accessible, selected, onSelect, onUnavailable }: {
  source: PhotoSource
  thumbnails: ThumbnailCache
  makeThumbnail: ThumbnailMaker
  photo: PhotoRecord
  accessible: boolean
  selected: boolean
  onSelect: (photoId: string) => void
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
}) => {
  const card = useRef<HTMLButtonElement>(null)
  const near = useNearViewport(card)
  const image = useThumbnailUrl({
    source,
    cache: thumbnails,
    makeThumbnail,
    photo,
    enabled: near,
    readable: accessible && photo.status === 'available',
    onUnavailable,
  })

  return (
    <button
      ref={card}
      className="photo-card group relative block w-full min-w-0 text-left"
      aria-pressed={selected}
      onClick={() => onSelect(photo.id)}
    >
      <PhotoImageView
        photo={photo}
        accessible={accessible}
        image={image}
        className={`aspect-[1.12] ${selectedOutline}`}
      />
      <span
        className={(
          'absolute top-2 right-2 z-10 grid size-5 place-items-center rounded-full bg-accent-strong text-xs ' +
          'text-white opacity-0 group-aria-pressed:opacity-100'
        )}
      >
        ✓
      </span>
      <span className="flex justify-between gap-1.5 px-0.5 pt-2.5 text-[11px]">
        <strong className="truncate font-bold" title={photo.relativePath}>{photo.name}</strong>
        <span className="font-mono text-[9px] whitespace-nowrap text-faint">{formatShortDate(photo.lastModified)}</span>
      </span>
    </button>
  )
}
