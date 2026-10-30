import { describe, expect, it } from 'vitest'
import { stubStorage } from '../test/storage'
import { isStoragePersisted, requestStoragePersistence } from './storagePersistence'

describe('isStoragePersisted', () => {
  it('ブラウザが保持を約束していれば true を返す', async () => {
    stubStorage({ persisted: async () => true })

    expect(await isStoragePersisted()).toBe(true)
  })

  it('Storage API がなければ false を返す', async () => {
    expect(await isStoragePersisted()).toBe(false)
  })

  it('確かめられなければ false を返す', async () => {
    stubStorage({ persisted: () => Promise.reject(new Error('確かめられない')) })

    expect(await isStoragePersisted()).toBe(false)
  })
})

describe('requestStoragePersistence', () => {
  it('ブラウザが保持を認めたかどうかを返す', async () => {
    stubStorage({ persist: async () => true })
    expect(await requestStoragePersistence()).toBe(true)

    stubStorage({ persist: async () => false })
    expect(await requestStoragePersistence()).toBe(false)
  })

  it('Storage API がないか、頼めなければ false を返す', async () => {
    expect(await requestStoragePersistence()).toBe(false)

    stubStorage({ persist: () => Promise.reject(new Error('頼めない')) })
    expect(await requestStoragePersistence()).toBe(false)
  })
})
