import type { CollectionRecord } from '../db/libraryStore'
import type { Library } from '../library/useLibrary'
import { CollectionNameForm } from './CollectionNameForm'
import { banner } from './styles'

/** コレクションの表示で行っている操作 */
export type CollectionEdit = 'rename' | 'delete' | null

/**
 * 表示中のコレクションの名前変更欄、または削除の確認を出す。
 * @param props.library ライブラリの状態と操作
 * @param props.collection 表示中のコレクション
 * @param props.edit 行っている操作。`null` なら何も出さない
 * @param props.onClose 名前を変えたか、操作をやめたときに呼ばれる
 * @param props.onDeleted 削除したときに呼ばれる
 * @returns 名前変更欄か削除の確認の React 要素。操作していなければ `null`
 */
export const CollectionEditor = ({ library, collection, edit, onClose, onDeleted }: {
  library: Library
  collection: CollectionRecord
  edit: CollectionEdit
  onClose: () => void
  onDeleted: () => void
}) => {
  /**
   * コレクションの名前を変える。変えられたら名前変更欄を閉じる。
   * @param name 新しい名前
   */
  const rename = async (name: string) => {
    if (await library.renameCollection(collection.id, name)) onClose()
  }

  /** コレクションを削除する。写真は削除しない。 */
  const remove = async () => {
    if (await library.deleteCollection(collection.id)) onDeleted()
  }

  if (edit === 'rename') {
    return (
      <div className="mt-[18px] max-w-sm">
        <CollectionNameForm
          key={collection.id}
          label="新しいコレクション名"
          submitLabel="変更"
          initialName={collection.name}
          collections={library.collections}
          exceptId={collection.id}
          onSubmit={rename}
          onCancel={onClose}
        />
      </div>
    )
  }
  if (edit === 'delete') {
    return (
      <div className={banner} role="alert">
        <span>コレクション「{collection.name}」を削除しますか？写真の原本やライブラリの写真は消えません。</span>
        <span className="flex flex-none gap-1.5">
          <button className="px-2 py-1.5 text-[11px]" onClick={onClose}>やめる</button>
          <button
            className="rounded-md bg-banner-ink px-2.5 py-1.5 text-[11px] font-bold text-white"
            onClick={remove}
          >
            削除する
          </button>
        </span>
      </div>
    )
  }
  return null
}
