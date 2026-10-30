import type { ReactNode } from 'react'

/**
 * 写真の一覧の代わりに出す案内。
 * @param props.icon 見出しの上に出す印。なければ出さない
 * @param props.title 見出し
 * @param props.children 見出しの下に添える説明や操作
 * @returns 案内の React 要素
 */
export const EmptyState = ({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) => (
  <div className="py-16 text-center text-xs text-[#768077] sm:py-24">
    {icon && <span className="text-[34px]">{icon}</span>}
    <h2 className="mt-3 mb-1 text-[17px] font-bold text-[#3d4c45]">{title}</h2>
    {children}
  </div>
)
