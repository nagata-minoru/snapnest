import { unsupportedMessage, type SourceSupport } from '../fs/photoSource'
import type { Library } from '../library/useLibrary'
import type { View } from '../library/view'
import { banner, bannerAction } from './styles'

/**
 * 写真一覧の上に出す警告。フォルダを開けない、保存できなくなった、再接続の候補がある、アクセス許可が要る、を知らせる。
 * @param props.library ライブラリの状態と操作
 * @param props.support フォルダを開けるかどうか
 * @param props.view 表示中の範囲
 * @param props.withCandidatesCount 再接続の候補がある写真の枚数
 * @returns 警告の React 要素
 */
export const LibraryBanners = ({ library, support, view, withCandidatesCount }: {
  library: Library
  support: SourceSupport
  view: View
  withCandidatesCount: number
}) => {
  const { folders, permissions } = library
  const foldersNeedingAccess = folders.filter((folder) => (
    permissions[folder.id] !== 'granted' && (view.kind !== 'folder' || folder.id === view.folderId)
  ))

  return (
    <>
      {support !== 'supported' && (
        <div className={banner} role="alert">{unsupportedMessage(support)}</div>
      )}
      {library.storeIssue === 'closed' && (
        <div className={banner} role="alert">
          <span>
            別のタブで新しい版の snapnest を開いたなどの理由で、写真の情報を保存できなくなりました。
            このページを再読み込みしてください。
          </span>
          <button className={bannerAction} onClick={() => window.location.reload()}>再読み込み</button>
        </div>
      )}
      {view.kind === 'missing' && withCandidatesCount > 0 && (
        <div className={banner}>
          {withCandidatesCount} 枚に再接続の候補があります。写真を選ぶと、候補を見比べてつなぎ直せます。
        </div>
      )}
      {foldersNeedingAccess.map((folder) => (
        <div key={folder.id} className={banner}>
          <span>
            「{folder.name}」へのアクセス許可が必要です。
            {permissions[folder.id] === 'denied' ? 'アクセスが拒否されています。' : ''}
          </span>
          <button className={bannerAction} onClick={() => library.requestAccess(folder.id)}>アクセスを許可</button>
        </div>
      ))}
    </>
  )
}
