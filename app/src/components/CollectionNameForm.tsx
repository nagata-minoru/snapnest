import { useId, useState, type FormEvent } from 'react'
import type { CollectionRecord } from '../db/libraryStore'
import { COLLECTION_NAME_MAX, validateCollectionName } from '../library/collections'

/** 背景の色ごとのフォームの見た目 */
const tones = {
  dark: {
    input: 'border-sidebar-active bg-sidebar-active text-white placeholder:text-sidebar-dim',
    submit: 'bg-leaf text-leaf-ink',
    cancel: 'text-sidebar-icon',
    error: 'text-caution',
  },
  light: {
    input: 'border-line bg-white text-ink placeholder:text-faint',
    submit: 'bg-accent-strong text-white',
    cancel: 'text-muted',
    error: 'text-warning-ink',
  },
}

/**
 * コレクション名を入力するフォーム。送信前に名前を検証し、使えなければ理由を表示する。
 * フォーム内で Esc キーを押すと取り消す。
 * @param props.label 入力欄の名前
 * @param props.submitLabel 送信ボタンの文言
 * @param props.initialName 最初に入れておく名前
 * @param props.collections 既存のコレクション。名前の重複の確認に使う
 * @param props.exceptId 名前を変えるコレクションの ID。重複の確認から除く
 * @param props.tone 置く場所の背景。サイドバーなら `dark`
 * @param props.onSubmit 使える名前で送信されたときに呼ばれる
 * @param props.onCancel 取り消されたときに呼ばれる
 * @returns フォームの React 要素
 */
export const CollectionNameForm = ({
  label, submitLabel, initialName = '', collections, exceptId, tone = 'light', onSubmit, onCancel,
}: {
  label: string
  submitLabel: string
  initialName?: string
  collections: readonly CollectionRecord[]
  exceptId?: string
  tone?: keyof typeof tones
  onSubmit: (name: string) => Promise<unknown>
  onCancel: () => void
}) => {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const errorId = useId()
  const colors = tones[tone]

  /**
   * 名前を検証して送信する。保存に失敗したときは呼び出し側が通知するため、フォームは開いたままにする。
   * @param event 送信のイベント
   */
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = validateCollectionName(name, collections, exceptId)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    await onSubmit(result.name)
    setSaving(false)
  }

  return (
    <form
      className="mt-2"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        // 重ねて開いている画面まで閉じないよう、Esc キーはここで止める
        event.stopPropagation()
        onCancel()
      }}
    >
      <input
        className={`w-full rounded-md border px-2.5 py-1.5 text-xs outline-none focus:border-accent ${colors.input}`}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        placeholder="コレクション名"
        maxLength={COLLECTION_NAME_MAX * 2}
        autoFocus
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setError(null)
        }}
      />
      {error && <p id={errorId} className={`mt-1 text-[10px] ${colors.error}`}>{error}</p>}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" className={`px-2 py-1 text-[11px] ${colors.cancel}`} onClick={onCancel}>
          やめる
        </button>
        <button
          type="submit"
          className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${colors.submit}`}
          disabled={saving}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
