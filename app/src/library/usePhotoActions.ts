import { useCallback } from 'react'
import type { PhotoRecord } from '../db/libraryStore'
import type { UnavailableReason } from '../fs/photoSource'
import { formatLocation } from './format'
import { mergePhotos, saveToStore, type LibraryContext } from './libraryContext'

/**
 * 写真の参照切れ、つなぎ直し、ライブラリから外すことを扱う。
 * @param context 状態を読み書きする手段
 * @returns 写真の操作
 */
export const usePhotoActions = (context: LibraryContext) => {
  /**
   * 原本を読めなかったことを受け取る。見つからなければ `missing` にし、権限がなければ権限を調べ直す。
   * @param photoId 読めなかった写真の ID
   * @param reason 読めなかった理由
   */
  const reportUnavailable = useCallback((photoId: string, reason: UnavailableReason) => {
    const { photos, folders } = context.latest.current
    const photo = photos.find((item) => item.id === photoId)
    if (!photo) return
    if (reason === 'not-found' && photo.status !== 'missing') {
      const updated: PhotoRecord = { ...photo, status: 'missing', updatedAt: Date.now() }
      context.setPhotos((current) => mergePhotos(current, [updated]))
      context.storeRef.current?.putPhotos([updated]).catch(() => {})
    }
    if (reason === 'permission') {
      const folder = folders.find((item) => item.id === photo.folderId)
      if (!folder) return
      context.source.queryPermission(folder.ref).then((permission) => {
        context.setPermissions((current) => ({ ...current, [folder.id]: permission }))
      })
    }
  }, [context])

  /**
   * 見つからない写真を、利用者が選んだ写真につなぎ直す。
   * コレクションへの所属を引き継ぎ、登録日時は古い方を残し、見つからない写真の記録を外す。
   * @param missingId 見つからない写真の ID
   * @param targetId つなぎ直す先の写真の ID
   * @returns つなぎ直せたら `true`
   */
  const reconnectPhoto = useCallback(async (missingId: string, targetId: string) => {
    const { photos, folders } = context.latest.current
    const missing = photos.find((photo) => photo.id === missingId)
    const target = photos.find((photo) => photo.id === targetId)
    if (!missing || !target || missing.status !== 'missing' || target.status !== 'available') return false
    const addedAt = Math.min(target.addedAt, missing.addedAt)
    const updated: PhotoRecord = { ...target, addedAt, updatedAt: Date.now() }
    const saved = await saveToStore(
      context, (store) => store.reconnectPhoto(missingId, updated), 'つなぎ直せませんでした。',
    )
    if (!saved) return false
    context.setPhotos((current) => mergePhotos(current.filter((photo) => photo.id !== missingId), [updated]))
    context.setMemberships((current) => {
      const joined = new Set(current.filter((item) => item.photoId === targetId).map((item) => item.collectionId))
      return current.flatMap((item) => {
        if (item.photoId !== missingId) return [item]
        return joined.has(item.collectionId) ? [] : [{ ...item, photoId: targetId }]
      })
    })
    /**
     * 写真の保存場所を表す文を作る。
     * @param photo 写真
     * @returns 「Pictures / trip / station.png」のような文
     */
    const locationOf = (photo: PhotoRecord) => (
      formatLocation(folders.find((folder) => folder.id === photo.folderId)?.name, photo.relativePath)
    )
    context.setNotice(`「${locationOf(missing)}」を「${locationOf(target)}」につなぎ直しました。`)
    return true
  }, [context])

  /**
   * 写真の記録を、コレクションへの所属・サムネイルとまとめてライブラリから外す。
   * @param photoId 外す写真の ID
   * @returns 外せたら `true`
   */
  const removePhoto = useCallback(async (photoId: string) => {
    const photo = context.latest.current.photos.find((item) => item.id === photoId)
    if (!photo) return false
    const saved = await saveToStore(context, (store) => store.deletePhoto(photoId), 'ライブラリから外せませんでした。')
    if (!saved) return false
    context.setPhotos((current) => current.filter((item) => item.id !== photoId))
    context.setMemberships((current) => current.filter((item) => item.photoId !== photoId))
    context.setNotice(`「${photo.name}」をライブラリから外しました。写真の原本には触れていません。`)
    return true
  }, [context])

  return { reportUnavailable, reconnectPhoto, removePhoto }
}
