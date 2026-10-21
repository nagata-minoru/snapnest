import { useState } from 'react'
import type { CollectionRecord } from '../db/libraryStore'
import { CollectionNameForm } from './CollectionNameForm'

/** コレクションの札の見た目 */
const chip = 'inline-flex items-center gap-1 rounded-[5px] bg-[#dfdfd6] px-[7px] py-[5px] text-[10px] text-[#45534c]'

/**
 * 詳細表示で、写真が入っているコレクションを示し、追加・削除する欄。
 * @param props.collections すべてのコレクション。表示する順に並べる
 * @param props.memberOf 写真が入っているコレクションの ID
 * @param props.onAdd コレクションに入れるときに呼ばれる
 * @param props.onRemove コレクションから外すときに呼ばれる
 * @param props.onCreate 新しいコレクションを作るときに呼ばれる。作ったコレクションを返す
 * @returns 欄の React 要素
 */
export const PhotoCollections = ({ collections, memberOf, onAdd, onRemove, onCreate }: {
  collections: readonly CollectionRecord[]
  memberOf: ReadonlySet<string>
  onAdd: (collectionId: string) => Promise<void>
  onRemove: (collectionId: string) => Promise<void>
  onCreate: (name: string) => Promise<CollectionRecord | null>
}) => {
  const [picking, setPicking] = useState(false)
  const joined = collections.filter((collection) => memberOf.has(collection.id))
  const candidates = collections.filter((collection) => !memberOf.has(collection.id))

  /**
   * 新しいコレクションを作り、写真を入れる。
   * @param name コレクション名
   */
  const createAndAdd = async (name: string) => {
    const created = await onCreate(name)
    if (!created) return
    await onAdd(created.id)
    setPicking(false)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-[5px]">
        {joined.length === 0 && !picking && <span className="py-[5px] text-[10px] text-muted">未登録</span>}
        {joined.map((collection) => (
          <span key={collection.id} className={chip}>
            {collection.name}
            <button
              className="text-[#8b928c]"
              aria-label={`「${collection.name}」から外す`}
              onClick={() => onRemove(collection.id)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          className="rounded-[5px] border border-dashed border-[#b1b7af] px-[7px] py-1 text-[10px] text-[#6f7c73]"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          ＋ 追加
        </button>
      </div>
      {picking && (
        <div className="mt-2.5 rounded-md bg-white/60 p-2.5">
          {candidates.length > 0 && (
            <ul className="mb-1 flex flex-wrap gap-[5px]" aria-label="追加できるコレクション">
              {candidates.map((collection) => (
                <li key={collection.id}>
                  <button
                    className={`${chip} hover:bg-note`}
                    onClick={async () => {
                      await onAdd(collection.id)
                      setPicking(false)
                    }}
                  >
                    {collection.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <CollectionNameForm
            label="新しいコレクションの名前"
            submitLabel="作って追加"
            collections={collections}
            onSubmit={createAndAdd}
            onCancel={() => setPicking(false)}
          />
        </div>
      )}
    </div>
  )
}
