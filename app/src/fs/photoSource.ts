declare const folderRefBrand: unique symbol
declare const fileRefBrand: unique symbol

/**
 * 抽象化レイヤーが発行するフォルダへの参照。
 * 中身は実装ごとに異なり、UI やドメインロジックは中を見ない。
 * IndexedDB に構造化複製で保存できる値であること。
 */
export type FolderRef = { readonly [folderRefBrand]: true }

/**
 * 抽象化レイヤーが発行するファイルへの参照。
 * {@link FolderRef} と同じく不透明で、IndexedDB に保存できる値であること。
 */
export type FileRef = { readonly [fileRefBrand]: true }

/** フォルダへの読み取り権限の状態。 */
export type AccessPermission = 'granted' | 'prompt' | 'denied'

/**
 * このブラウザでフォルダを参照できるか。
 * `insecure-context` は、https や localhost 以外で開いたため API が使えない状態。
 * `unsupported-browser` は、ブラウザが API を備えていない状態。
 */
export type SourceSupport = 'supported' | 'insecure-context' | 'unsupported-browser'

const unsupportedMessages = {
  'insecure-context': (
    'このページは安全な接続で開かれていないため、フォルダを参照できません。' +
    'https:// で始まるアドレスか http://localhost で開いてください。'
  ),
  'unsupported-browser': 'このブラウザはフォルダの参照に対応していません。パソコン版の Chrome で開いてください。',
} satisfies Record<Exclude<SourceSupport, 'supported'>, string>

/**
 * フォルダを参照できない理由に応じた案内を返す。
 * @param support フォルダを参照できない理由
 * @returns 利用者向けの案内
 */
export const unsupportedMessage = (support: Exclude<SourceSupport, 'supported'>) => unsupportedMessages[support]

/** フォルダ選択の結果。 */
export type PickResult =
  | { status: 'picked'; ref: FolderRef; name: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

/** フォルダ内で見つかった画像ファイルの情報。 */
export type ScannedFile = {
  ref: FileRef
  /** 選択したフォルダからの相対パス。区切りは `/` */
  relativePath: string
  name: string
  size: number
  lastModified: number
  type: string
}

/** ファイル読み込みの結果。読めない場合も例外にせず理由を返す。 */
export type ReadResult =
  | { ok: true; file: File }
  | { ok: false; reason: UnavailableReason }

/** ファイルを読めなかった理由。`unavailable` は参照の破損など、理由を特定できないもの */
export type UnavailableReason = 'not-found' | 'permission' | 'unavailable'

/**
 * ローカルの写真へアクセスするための抽象化レイヤー。
 * File System Access API などブラウザ固有の API はこの裏に置く。
 */
export interface PhotoSource {
  /** このブラウザでフォルダを参照できるか */
  readonly support: SourceSupport

  /**
   * 利用者にフォルダを選んでもらう。
   * @returns 選択結果。キャンセルや失敗も結果として返す
   */
  pickFolder(): Promise<PickResult>

  /**
   * 2 つの参照が同じフォルダを指すか調べる。
   * @param a 比較するフォルダ
   * @param b 比較するフォルダ
   * @returns 同じフォルダなら `true`
   */
  isSameFolder(a: FolderRef, b: FolderRef): Promise<boolean>

  /**
   * 利用者に尋ねずに、フォルダへの読み取り権限を調べる。
   * @param folder 調べるフォルダ
   * @returns 権限の状態
   */
  queryPermission(folder: FolderRef): Promise<AccessPermission>

  /**
   * フォルダへの読み取り権限を利用者に求める。利用者の操作の中で呼ぶ。
   * @param folder 権限を求めるフォルダ
   * @returns 求めた後の権限の状態
   */
  requestPermission(folder: FolderRef): Promise<AccessPermission>

  /**
   * フォルダ以下の画像ファイルを再帰的に列挙する。
   * フォルダ自体が読めない場合は例外を投げる。
   * @param folder 列挙するフォルダ
   * @returns 画像ファイルの情報を順に返す非同期イテレーター
   */
  scanImages(folder: FolderRef): AsyncIterable<ScannedFile>

  /**
   * ファイルの内容を読む。
   * @param file 読むファイル
   * @returns 読み込み結果
   */
  readFile(file: FileRef): Promise<ReadResult>
}

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'])

/**
 * ファイル名の拡張子を小文字で取り出す。
 * @param name ファイル名
 * @returns 拡張子。拡張子がなければ空文字列
 */
export const extensionOf = (name: string) => {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

/**
 * ブラウザで表示できる画像として扱うファイルか判定する。
 * 隠しファイル（`.` で始まる名前）は対象外にする。
 * @param name ファイル名
 * @returns 対象の画像なら `true`
 */
export const isImageFileName = (name: string) => !name.startsWith('.') && imageExtensions.has(extensionOf(name))

/**
 * フォルダを参照できないブラウザ向けの PhotoSource を作る。
 * どの操作も失敗を結果として返し、例外は投げない。
 * @param support フォルダを参照できない理由
 * @returns 非対応ブラウザ用の PhotoSource
 */
export const createUnsupportedSource = (
  support: Exclude<SourceSupport, 'supported'> = 'unsupported-browser',
): PhotoSource => ({
  support,

  /**
   * フォルダを選ばせず、失敗を返す。
   * @returns 参照できない理由を伝える失敗の結果
   */
  pickFolder: async () => ({ status: 'failed', message: unsupportedMessage(support) }),

  /**
   * 常に別のフォルダとみなす。
   * @returns 常に `false`
   */
  isSameFolder: async () => false,

  /**
   * 常に権限がないとみなす。
   * @returns 常に `denied`
   */
  queryPermission: async () => 'denied',

  /**
   * 権限を求めず、権限がないとみなす。
   * @returns 常に `denied`
   */
  requestPermission: async () => 'denied',

  /**
   * 何も列挙しない。
   * @returns 何も返さない非同期ジェネレーター
   */
  scanImages: async function* () {},

  /**
   * ファイルを読まず、読めなかった結果を返す。
   * @returns 理由を `unavailable` とした失敗の結果
   */
  readFile: async () => ({ ok: false, reason: 'unavailable' }),
})
