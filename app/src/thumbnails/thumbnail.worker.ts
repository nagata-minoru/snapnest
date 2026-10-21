import { thumbnailSize, type ThumbnailRequest, type ThumbnailResponse } from './thumbnailMaker'

/** この Worker で使う範囲の DedicatedWorkerGlobalScope */
type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<ThumbnailRequest>) => void): void
  postMessage(message: ThumbnailResponse): void
}

const scope = self as unknown as WorkerScope

/**
 * 原本を展開し、縮小した WebP 画像を作る。
 * 縮小するまでもない小さな画像は、原本の複製を保存しないよう作らない。
 * @param file 原本
 * @returns サムネイルの画像。作らなければ `null`
 */
const makeThumbnail = async (file: File) => {
  const bitmap = await createImageBitmap(file)
  try {
    const size = thumbnailSize(bitmap.width, bitmap.height)
    if (!size) return null
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
  } finally {
    bitmap.close()
  }
}

scope.addEventListener('message', (event) => {
  const { id, file } = event.data
  makeThumbnail(file)
    .catch(() => null)
    .then((blob) => scope.postMessage({ id, blob }))
})
