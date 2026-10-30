import { useCallback } from 'react'
import type { FolderRecord } from '../db/libraryStore'
import { unsupportedMessage, type FolderRef } from '../fs/photoSource'
import { mergePhotos, requestPersistence, saveToStore, type LibraryContext } from './libraryContext'
import { ScanError, scanFolder } from './scanFolder'

/**
 * フォルダの読み込み結果を利用者向けの文に直す。
 * @param found 見つかった写真の数
 * @param missing 見つからなくなった写真の数
 * @returns 通知する文
 */
const scanMessage = (found: number, missing: number) => (
  `${found} 枚の写真を読み込みました。` + (missing ? `${missing} 枚が見つからなくなりました。` : '')
)

/**
 * フォルダの登録、読み込み、アクセス許可を扱う。
 * @param context 状態を読み書きする手段
 * @returns フォルダの操作
 */
export const useFolderActions = (context: LibraryContext) => {
  /**
   * フォルダを読み込み、結果を画面と通知に反映する。
   * @param folder 読み込むフォルダ
   */
  const runScan = useCallback(async (folder: FolderRecord) => {
    const { source, storeRef, latest, setPhotos, setScan, setNotice } = context
    const store = storeRef.current
    if (!store) return
    setScan({ folderId: folder.id, found: 0 })
    try {
      const outcome = await scanFolder({
        source,
        store,
        folder,
        existing: latest.current.photos.filter((photo) => photo.folderId === folder.id),
        onBatch: (batch, found) => {
          setPhotos((current) => mergePhotos(current, batch))
          setScan({ folderId: folder.id, found })
        },
      })
      setPhotos((current) => mergePhotos(current, outcome.missing))
      context.setFolders((current) => current.map((item) => (
        item.id === folder.id ? { ...item, scannedAt: Date.now() } : item
      )))
      setNotice(scanMessage(outcome.found, outcome.missing.length))
    } catch (error) {
      const found = error instanceof ScanError ? error.found : 0
      setNotice(
        `「${folder.name}」の読み込みが途中で止まりました（${found} 枚まで）。` +
        'フォルダへのアクセスを確認して、再読み込みしてください。',
      )
    } finally {
      setScan(null)
    }
  }, [context])

  /**
   * 保存済みのフォルダから、指定した参照と同じものを探す。
   * @param ref 探すフォルダの参照
   * @returns 見つかったフォルダ。なければ `undefined`
   */
  const findSameFolder = useCallback(async (ref: FolderRef) => {
    for (const folder of context.latest.current.folders) {
      if (await context.source.isSameFolder(folder.ref, ref)) return folder
    }
    return undefined
  }, [context])

  /**
   * 利用者に選んでもらったフォルダを登録し、読み込む。登録済みのフォルダなら情報を更新する。
   */
  const addFolder = useCallback(async () => {
    const { source, setNotice } = context
    if (context.latest.current.scanning || !context.storeRef.current) return
    if (source.support !== 'supported') {
      setNotice(unsupportedMessage(source.support))
      return
    }
    const result = await source.pickFolder()
    if (result.status === 'cancelled') return
    if (result.status === 'failed') {
      setNotice(result.message)
      return
    }

    const same = await findSameFolder(result.ref)
    let folder: FolderRecord
    if (same) {
      folder = { ...same, name: result.name, ref: result.ref }
    } else {
      folder = { id: crypto.randomUUID(), name: result.name, ref: result.ref, addedAt: Date.now(), scannedAt: null }
    }
    const saved = await saveToStore(
      context, (store) => store.putFolder(folder), 'フォルダの情報を保存できませんでした。',
    )
    if (!saved) return
    context.setFolders((current) => (
      same ? current.map((item) => item.id === folder.id ? folder : item) : [...current, folder]
    ))
    context.setPermissions((current) => ({ ...current, [folder.id]: 'granted' }))
    requestPersistence()
    await runScan(folder)
  }, [context, findSameFolder, runScan])

  /**
   * フォルダの読み取り権限を求める。
   * @param folder 権限を求めるフォルダ
   * @returns 求めた後の権限の状態
   */
  const ensurePermission = useCallback(async (folder: FolderRecord) => {
    const { source } = context
    const current = await source.queryPermission(folder.ref)
    const permission = current === 'granted' ? current : await source.requestPermission(folder.ref)
    context.setPermissions((items) => ({ ...items, [folder.id]: permission }))
    if (permission !== 'granted') {
      context.setNotice(`「${folder.name}」へのアクセスが許可されませんでした。写真を表示するには許可が必要です。`)
    }
    return permission
  }, [context])

  /**
   * フォルダへのアクセス許可を求める。
   * @param folderId 許可を求めるフォルダの ID
   */
  const requestAccess = useCallback(async (folderId: string) => {
    const folder = context.latest.current.folders.find((item) => item.id === folderId)
    if (folder) await ensurePermission(folder)
  }, [context, ensurePermission])

  /**
   * 権限を確かめてから、フォルダを読み込み直す。
   * @param folderId 読み込み直すフォルダの ID
   */
  const rescan = useCallback(async (folderId: string) => {
    const { latest } = context
    const folder = latest.current.folders.find((item) => item.id === folderId)
    if (!folder || latest.current.scanning) return
    if (await ensurePermission(folder) === 'granted') await runScan(folder)
  }, [context, ensurePermission, runScan])

  return { addFolder, rescan, requestAccess }
}
