import { useCallback } from 'react'
import type { CollectionRecord, MembershipRecord } from '../db/libraryStore'
import { validateCollectionName } from './collections'
import { requestPersistence, saveToStore, type LibraryContext } from './libraryContext'

/**
 * コレクションの作成・変更・削除と、写真の出し入れを扱う。
 * @param context 状態を読み書きする手段
 * @returns コレクションの操作
 */
export const useCollectionActions = (context: LibraryContext) => {
  /**
   * コレクションを作る。
   * @param input 入力された名前
   * @returns 作ったコレクション。作れなければ `null`
   */
  const createCollection = useCallback(async (input: string) => {
    if (!context.storeRef.current) return null
    const result = validateCollectionName(input, context.latest.current.collections)
    if ('error' in result) {
      context.setNotice(result.error)
      return null
    }
    const now = Date.now()
    const collection: CollectionRecord = { id: crypto.randomUUID(), name: result.name, createdAt: now, updatedAt: now }
    const saved = await saveToStore(
      context, (store) => store.putCollection(collection), 'コレクションを保存できませんでした。',
    )
    if (!saved) return null
    context.setCollections((current) => [...current, collection])
    requestPersistence(context)
    return collection
  }, [context])

  /**
   * コレクションの名前を変える。
   * @param collectionId コレクションの ID
   * @param input 入力された名前
   * @returns 変えられたら `true`
   */
  const renameCollection = useCallback(async (collectionId: string, input: string) => {
    const { collections } = context.latest.current
    const collection = collections.find((item) => item.id === collectionId)
    if (!context.storeRef.current || !collection) return false
    const result = validateCollectionName(input, collections, collectionId)
    if ('error' in result) {
      context.setNotice(result.error)
      return false
    }
    const renamed: CollectionRecord = { ...collection, name: result.name, updatedAt: Date.now() }
    const saved = await saveToStore(
      context, (store) => store.putCollection(renamed), 'コレクションの名前を保存できませんでした。',
    )
    if (!saved) return false
    context.setCollections((current) => current.map((item) => item.id === collectionId ? renamed : item))
    return true
  }, [context])

  /**
   * コレクションと、そこへの所属を削除する。写真そのものは残す。
   * @param collectionId 削除するコレクションの ID
   * @returns 削除できたら `true`
   */
  const deleteCollection = useCallback(async (collectionId: string) => {
    const collection = context.latest.current.collections.find((item) => item.id === collectionId)
    if (!collection) return false
    const saved = await saveToStore(
      context, (store) => store.deleteCollection(collectionId), 'コレクションを削除できませんでした。',
    )
    if (!saved) return false
    context.setCollections((current) => current.filter((item) => item.id !== collectionId))
    context.setMemberships((current) => current.filter((item) => item.collectionId !== collectionId))
    context.setNotice(`コレクション「${collection.name}」を削除しました。写真はライブラリに残っています。`)
    return true
  }, [context])

  /**
   * 写真をコレクションに入れる。入っていれば何もしない。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   */
  const addToCollection = useCallback(async (collectionId: string, photoId: string) => {
    const exists = context.latest.current.memberships.some((item) => (
      item.collectionId === collectionId && item.photoId === photoId
    ))
    if (exists) return
    const membership: MembershipRecord = { collectionId, photoId, addedAt: Date.now() }
    const saved = await saveToStore(
      context, (store) => store.putMembership(membership), 'コレクションに追加できませんでした。',
    )
    if (saved) context.setMemberships((current) => [...current, membership])
  }, [context])

  /**
   * 写真をコレクションから外す。写真そのものは残す。
   * @param collectionId コレクションの ID
   * @param photoId 写真の ID
   */
  const removeFromCollection = useCallback(async (collectionId: string, photoId: string) => {
    const saved = await saveToStore(
      context, (store) => store.deleteMembership(collectionId, photoId), 'コレクションから外せませんでした。',
    )
    if (!saved) return
    context.setMemberships((current) => current.filter((item) => (
      !(item.collectionId === collectionId && item.photoId === photoId)
    )))
  }, [context])

  return { createCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection }
}
