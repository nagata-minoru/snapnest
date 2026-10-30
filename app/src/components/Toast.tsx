/**
 * 画面の下に出す通知。
 * @param props.notice 通知の文。`null` なら何も出さない
 * @param props.onDismiss 閉じるボタンが押されたときに呼ばれる
 * @returns 通知の React 要素。通知がなければ `null`
 */
export const Toast = ({ notice, onDismiss }: { notice: string | null; onDismiss: () => void }) => {
  if (!notice) return null
  return (
    <div
      className={(
        'fixed bottom-6 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg bg-toast ' +
        'px-[15px] py-3 text-xs text-white shadow-[0_8px_20px_#0003]'
      )}
      role="status"
    >
      {notice}
      <button className="ml-3.5 text-base text-[#d1ded4]" aria-label="通知を閉じる" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
