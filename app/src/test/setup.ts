import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  // テストごとに空の IndexedDB を用意する
  globalThis.indexedDB = new IDBFactory()
  // jsdom には URL.createObjectURL がない
  let count = 0
  URL.createObjectURL = vi.fn(() => `blob:snapnest-test/${++count}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})
