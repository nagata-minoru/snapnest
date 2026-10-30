/**
 * ブラウザが、この保存領域を容量不足のときにも消さずに保つと約束しているか確かめる。
 * Storage API がないブラウザや、確かめられなかったときは `false` を返す。
 * @returns 消さずに保つなら `true`
 */
export const isStoragePersisted = async () => {
  try {
    return await navigator.storage?.persisted?.() ?? false
  } catch {
    return false
  }
}

/**
 * ブラウザに、この保存領域を容量不足のときにも消さずに保つよう頼む。
 * Chrome は利用状況から自動で判断し、断っても何も表示しない。
 * Storage API がないブラウザや、頼めなかったときは `false` を返す。
 * @returns 消さずに保つことになったら `true`
 */
export const requestStoragePersistence = async () => {
  try {
    return await navigator.storage?.persist?.() ?? false
  } catch {
    return false
  }
}
