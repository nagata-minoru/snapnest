import type { PhotoRecord } from '../db/libraryStore'

/** 見つからない写真と候補の、一致した項目 */
export type CandidateMatch = {
  name: boolean
  size: boolean
  lastModified: boolean
}

/** 見つからない写真につなぎ直す候補。 */
export type ReconnectCandidate = {
  photo: PhotoRecord
  match: CandidateMatch
  /** ほかの見つからない写真の候補にもなっているか */
  shared: boolean
}

/**
 * ファイル名を比べるために正規化する。濁点の合成・分解と、大文字・小文字の違いを無視する。
 * @param name ファイル名
 * @returns 正規化したファイル名
 */
const nameKey = (name: string) => name.normalize('NFC').toLowerCase()

/**
 * 一致した項目の数を数える。
 * @param match 一致した項目
 * @returns 一致した項目の数
 */
const matchCount = (match: CandidateMatch) => Number(match.name) + Number(match.size) + Number(match.lastModified)

/**
 * 見つからない写真ごとに、つなぎ直す候補を探す。
 * 参照できる写真のうち、サイズが同じで、ファイル名か更新日時も同じものを候補にする。
 * サイズだけの一致は別の写真である可能性が高いため候補にしない。
 * 候補は一致した項目が多い順、同じなら相対パス順に並べる。
 * @param photos ライブラリのすべての写真
 * @returns 見つからない写真の ID ごとの候補。候補がなければ空の配列
 */
export const findReconnectCandidates = (photos: readonly PhotoRecord[]) => {
  const availableBySize = new Map<number, PhotoRecord[]>()
  for (const photo of photos) {
    if (photo.status !== 'available') continue
    availableBySize.set(photo.size, [...(availableBySize.get(photo.size) ?? []), photo])
  }

  const found = new Map<string, Omit<ReconnectCandidate, 'shared'>[]>()
  const claims = new Map<string, number>()
  for (const missing of photos) {
    if (missing.status !== 'missing') continue
    const candidates = (availableBySize.get(missing.size) ?? [])
      .map((photo) => ({
        photo,
        match: {
          name: nameKey(photo.name) === nameKey(missing.name),
          size: true,
          lastModified: photo.lastModified === missing.lastModified,
        },
      }))
      .filter(({ match }) => match.name || match.lastModified)
      .sort((a, b) => (
        matchCount(b.match) - matchCount(a.match) || a.photo.relativePath.localeCompare(b.photo.relativePath)
      ))
    for (const { photo } of candidates) claims.set(photo.id, (claims.get(photo.id) ?? 0) + 1)
    found.set(missing.id, candidates)
  }

  const result = new Map<string, ReconnectCandidate[]>()
  for (const [missingId, candidates] of found) {
    result.set(missingId, candidates.map((candidate) => ({
      ...candidate, shared: (claims.get(candidate.photo.id) ?? 0) > 1,
    })))
  }
  return result
}

/**
 * 候補の一致した項目を利用者向けの文に直す。
 * @param match 一致した項目
 * @returns 「名前・サイズ・更新日時が一致」のような文
 */
export const describeMatch = (match: CandidateMatch) => {
  const labels: Array<[keyof CandidateMatch, string]> = [
    ['name', '名前'], ['size', 'サイズ'], ['lastModified', '更新日時'],
  ]
  const matched = labels.filter(([key]) => match[key]).map(([, label]) => label)
  const differed = labels.filter(([key]) => !match[key]).map(([, label]) => label)
  return `${matched.join('・')}が一致` + (differed.length ? `（${differed.join('・')}は異なる）` : '')
}
