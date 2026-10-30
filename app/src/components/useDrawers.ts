import { useEffect, useState } from 'react'

/**
 * 狭い画面で重ねて開くサイドバーと詳細表示の開閉を扱う。Esc キーで両方を閉じる。
 * 広い画面では常に表示するため、開閉の状態は使わない。
 * @returns サイドバー・詳細表示を開いているか、開閉を切り替える関数、両方を閉じる関数
 */
export const useDrawers = () => {
  const [navOpen, setNavOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  /** 重ねて開いているサイドバーと詳細表示を閉じる。 */
  const closeDrawers = () => {
    setNavOpen(false)
    setInspectorOpen(false)
  }

  useEffect(() => {
    if (!navOpen && !inspectorOpen) return
    /**
     * Esc キーで重ねて開いているものを閉じる。
     * @param event キーボードのイベント
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawers()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navOpen, inspectorOpen])

  return { navOpen, setNavOpen, inspectorOpen, setInspectorOpen, closeDrawers }
}
