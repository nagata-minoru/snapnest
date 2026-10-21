import { useState } from 'react'
import type { PhotoRecord, ThumbnailCache } from '../db/libraryStore'
import type { PhotoSource, UnavailableReason } from '../fs/photoSource'
import { describeMatch, type ReconnectCandidate } from '../library/reconnect'
import { noThumbnail } from '../thumbnails/thumbnailMaker'
import { PhotoImageView } from './PhotoCard'
import { useThumbnailUrl } from './usePhotoUrl'

/** 確かめている操作。つなぎ直す先の写真の ID か、ライブラリから外すこと */
type Confirming = { kind: 'reconnect'; targetId: string } | { kind: 'remove' } | null

/** 確認の枠の見た目 */
const confirmBox = 'mt-2 rounded-md bg-banner p-2.5 text-[10px] leading-relaxed text-banner-ink'

/** 確認の枠で、実行するボタンの見た目 */
const confirmButton = 'rounded-md bg-banner-ink px-2.5 py-1 text-[11px] font-bold text-white'

/** 小さな操作ボタンの見た目 */
const smallButton = 'rounded-md border border-[#c8c6bc] bg-white px-2.5 py-1 text-[11px] text-[#45534c]'

/**
 * 候補の写真の小さな画像。保存済みのサムネイルがあれば使い、なければ原本を表示する。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.thumbnails サムネイルのキャッシュ
 * @param props.photo 候補の写真
 * @param props.accessible 候補のフォルダへのアクセスが許可されているか
 * @param props.onUnavailable 原本を読めなかったときに呼ばれる
 * @returns 画像の React 要素
 */
const CandidatePreview = ({ source, thumbnails, photo, accessible, onUnavailable }: {
  source: PhotoSource
  thumbnails: ThumbnailCache
  photo: PhotoRecord
  accessible: boolean
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
}) => {
  const image = useThumbnailUrl({
    source, cache: thumbnails, makeThumbnail: noThumbnail, photo, enabled: true, readable: accessible, onUnavailable,
  })
  return <PhotoImageView photo={photo} accessible={accessible} image={image} className="size-14 flex-none" />
}

/**
 * 詳細表示で、見つからない写真につなぎ直す候補を示す欄。
 * 自動ではつながず、利用者が画像と一致した項目を見比べて選び、確かめてからつなぎ直す。
 * 候補がなければ、探し方を案内する。どちらの場合も、写真の記録をライブラリから外せる。
 * @param props.source ファイルアクセスの抽象化レイヤー
 * @param props.thumbnails サムネイルのキャッシュ
 * @param props.photo 見つからない写真
 * @param props.candidates つなぎ直す候補
 * @param props.locationOf 写真の保存場所を表す文を返す
 * @param props.isAccessible 写真のフォルダへのアクセスが許可されているかを返す
 * @param props.onUnavailable 候補の原本を読めなかったときに呼ばれる
 * @param props.onReconnect つなぎ直すときに呼ばれる。つなぎ直せたら `true` を返す
 * @param props.onRemove ライブラリから外すときに呼ばれる。外せたら `true` を返す
 * @returns 欄の React 要素
 */
export const ReconnectCandidates = ({
  source, thumbnails, photo, candidates, locationOf, isAccessible, onUnavailable, onReconnect, onRemove,
}: {
  source: PhotoSource
  thumbnails: ThumbnailCache
  photo: PhotoRecord
  candidates: readonly ReconnectCandidate[]
  locationOf: (photo: PhotoRecord) => string
  isAccessible: (photo: PhotoRecord) => boolean
  onUnavailable: (photoId: string, reason: UnavailableReason) => void
  onReconnect: (targetId: string) => Promise<boolean>
  onRemove: () => Promise<boolean>
}) => {
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [busy, setBusy] = useState(false)

  /**
   * 確かめた操作を実行する。失敗したときは呼び出し側が通知するため、確認は開いたままにする。
   * @param run 実行する操作
   */
  const perform = async (run: () => Promise<boolean>) => {
    setBusy(true)
    const done = await run()
    setBusy(false)
    if (done) setConfirming(null)
  }

  return (
    <div className="text-[10px] text-[#47534d]">
      {candidates.length === 0 && (
        <p className="leading-relaxed text-muted">
          候補は見つかりませんでした。
          移動先のフォルダを開くか再読み込みすると、名前・サイズ・更新日時が同じ写真を候補として探します。
        </p>
      )}
      {candidates.length > 1 && (
        <p className="mb-2 leading-relaxed text-warning-ink">候補が複数あります。画像を見比べてから選んでください。</p>
      )}
      {candidates.length > 0 && (
        <ul className="space-y-2.5" aria-label="再接続の候補">
          {candidates.map(({ photo: candidate, match, shared }) => {
            const location = locationOf(candidate)
            return (
              <li key={candidate.id} className="rounded-md bg-white/60 p-2">
                <div className="flex gap-2.5">
                  <CandidatePreview
                    source={source}
                    thumbnails={thumbnails}
                    photo={candidate}
                    accessible={isAccessible(candidate)}
                    onUnavailable={onUnavailable}
                  />
                  <div className="min-w-0 flex-1">
                    <strong className="block text-[11px] break-all">{location}</strong>
                    <small className="mt-0.5 block text-[9px] text-muted">{describeMatch(match)}</small>
                    {shared && (
                      <small className="mt-0.5 block text-[9px] text-warning-ink">
                        ほかの見つからない写真の候補にもなっています。
                      </small>
                    )}
                    <button
                      className={`${smallButton} mt-1.5`}
                      aria-label={`「${location}」につなぐ`}
                      onClick={() => setConfirming({ kind: 'reconnect', targetId: candidate.id })}
                    >
                      この写真につなぐ
                    </button>
                  </div>
                </div>
                {confirming?.kind === 'reconnect' && confirming.targetId === candidate.id && (
                  <div className={confirmBox} role="alert">
                    <p>
                      「{photo.name}」の記録を、この写真につなぎ直します。
                      コレクションへの所属を引き継ぎ、見つからない写真の記録はライブラリから外します。
                    </p>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <button className="px-2 py-1 text-[11px]" onClick={() => setConfirming(null)}>やめる</button>
                      <button
                        className={confirmButton}
                        disabled={busy}
                        onClick={() => perform(() => onReconnect(candidate.id))}
                      >
                        つなぎ直す
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button className={`${smallButton} mt-3`} onClick={() => setConfirming({ kind: 'remove' })}>
        ライブラリから外す
      </button>
      {confirming?.kind === 'remove' && (
        <div className={confirmBox} role="alert">
          <p>
            「{photo.name}」の記録をライブラリから外しますか？
            コレクションへの所属と保存済みのサムネイルも消えます。写真の原本には触れません。
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button className="px-2 py-1 text-[11px]" onClick={() => setConfirming(null)}>やめる</button>
            <button className={confirmButton} disabled={busy} onClick={() => perform(onRemove)}>外す</button>
          </div>
        </div>
      )}
    </div>
  )
}
