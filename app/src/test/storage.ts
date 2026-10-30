import { afterEach } from 'vitest'

/** テストで置き換える Storage API のうち、保存領域の保持に関わる部分 */
export type FakeStorage = Partial<Pick<StorageManager, 'persist' | 'persisted'>>

/**
 * `navigator.storage` を置き換える。jsdom には Storage API がない。
 * 置き換えたものは各テストの後で取り除く。
 * @param storage 代わりに使う Storage API
 */
export const stubStorage = (storage: FakeStorage) => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage')
})
