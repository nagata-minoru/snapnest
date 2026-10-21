import { describe, expect, it, vi } from 'vitest'
import {
  createThumbnailQueue, createWorkerThumbnailMaker, thumbnailSize, THUMBNAIL_LONG_SIDE_LIMIT, THUMBNAIL_SHORT_SIDE,
  type ThumbnailMaker,
} from './thumbnailMaker'

/**
 * テスト用の原本を作る。
 * @param name ファイル名
 * @returns 原本
 */
const fileOf = (name: string) => new File(['image'], name, { type: 'image/jpeg' })

/**
 * 外から終わらせられる ThumbnailMaker を作る。
 * @returns ThumbnailMaker と、始まった依頼のファイル名、依頼を終わらせる関数
 */
const createControlledMaker = () => {
  const started: string[] = []
  const finishers = new Map<string, (blob: Blob | null) => void>()
  const make = vi.fn<ThumbnailMaker>((file) => new Promise((resolve) => {
    started.push(file.name)
    finishers.set(file.name, resolve)
  }))

  /**
   * 依頼を終わらせ、次の依頼が始まるのを待つ。
   * @param name 終わらせる依頼のファイル名
   */
  const finish = async (name: string) => {
    finishers.get(name)?.(new Blob([name]))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { make, started, finish }
}

describe('thumbnailSize', () => {
  it('短辺を決まった長さに縮める', () => {
    expect(thumbnailSize(4000, 3000)).toEqual({ width: 533, height: THUMBNAIL_SHORT_SIDE })
    expect(thumbnailSize(3000, 4000)).toEqual({ width: THUMBNAIL_SHORT_SIDE, height: 533 })
  })

  it('細長い画像は長辺を抑える', () => {
    expect(thumbnailSize(12000, 1000)).toEqual({ width: THUMBNAIL_LONG_SIDE_LIMIT, height: 100 })
  })

  it('縮めるまでもない画像や、大きさの分からない画像は作らない', () => {
    expect(thumbnailSize(THUMBNAIL_SHORT_SIDE, 600)).toBeNull()
    expect(thumbnailSize(200, 100)).toBeNull()
    expect(thumbnailSize(0, 100)).toBeNull()
    expect(thumbnailSize(Number.NaN, 100)).toBeNull()
  })
})

describe('createThumbnailQueue', () => {
  it('同時に作る数を制限し、終わったら次を始める', async () => {
    const { make, started, finish } = createControlledMaker()
    const queue = createThumbnailQueue(make, 2)

    const results = ['a', 'b', 'c'].map((name) => queue(fileOf(name)))
    expect(started).toEqual(['a', 'b'])

    await finish('a')
    expect(started).toEqual(['a', 'b', 'c'])
    await finish('b')
    await finish('c')

    expect(await Promise.all(results.map(async (result) => (await result)?.text()))).toEqual(['a', 'b', 'c'])
  })

  it('待っている間に中止された依頼は作らない', async () => {
    const { make, started, finish } = createControlledMaker()
    const queue = createThumbnailQueue(make, 1)
    const abort = new AbortController()

    queue(fileOf('a'))
    const waiting = queue(fileOf('b'), abort.signal)
    abort.abort()

    expect(await waiting).toBeNull()
    await finish('a')
    expect(started).toEqual(['a'])
    expect(await queue(fileOf('c'), abort.signal)).toBeNull()
  })

  it('作るのに失敗したら null を返し、次の依頼を続ける', async () => {
    const make = vi.fn<ThumbnailMaker>()
      .mockRejectedValueOnce(new Error('壊れた画像'))
      .mockResolvedValueOnce(new Blob(['ok']))
    const queue = createThumbnailQueue(make, 1)

    const [failed, succeeded] = await Promise.all([queue(fileOf('a')), queue(fileOf('b'))])

    expect(failed).toBeNull()
    expect(await succeeded?.text()).toBe('ok')
  })
})

describe('createWorkerThumbnailMaker', () => {
  it('Worker を使えないブラウザでは作らない', async () => {
    expect(typeof Worker).toBe('undefined')

    expect(await createWorkerThumbnailMaker()(fileOf('a'))).toBeNull()
  })
})
