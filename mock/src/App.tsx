import { useMemo, useState } from 'react'

type Photo = {
  id: number
  title: string
  date: string
  location: string
  tags: string[]
  kind: string
  tone: string
}

const photos: Photo[] = [
  {
    id: 1, title: '朝の余白', date: '2026年10月18日', location: '鎌倉',
    tags: ['散歩', '海'], kind: 'shore', tone: 'a',
  },
  {
    id: 2, title: '窓辺', date: '2026年10月16日', location: '自宅',
    tags: ['日常'], kind: 'window', tone: 'b',
  },
  {
    id: 3, title: '夕方の駅', date: '2026年10月14日', location: '横浜',
    tags: ['街'], kind: 'station', tone: 'c',
  },
  {
    id: 4, title: '初秋', date: '2026年10月11日', location: '代々木公園',
    tags: ['散歩', '植物'], kind: 'leaf', tone: 'd',
  },
  {
    id: 5, title: '青い椅子', date: '2026年10月8日', location: '清澄白河',
    tags: ['街'], kind: 'chair', tone: 'e',
  },
  {
    id: 6, title: 'コーヒーの湯気', date: '2026年10月6日', location: '自宅',
    tags: ['日常'], kind: 'coffee', tone: 'f',
  },
  {
    id: 7, title: '帰り道', date: '2026年10月3日', location: '鎌倉',
    tags: ['海', '散歩'], kind: 'road', tone: 'g',
  },
  {
    id: 8, title: '光の層', date: '2026年9月28日', location: '東京',
    tags: ['街'], kind: 'light', tone: 'h',
  },
]

const collections: Array<[string, number]> = [
  ['お気に入り', 18],
  ['散歩', 42],
  ['2026 秋', 27],
  ['海のある日', 12],
]

/**
 * snapnest の写真ライブラリ画面のモック。
 * サイドバー、写真一覧、詳細表示、通知を固定データで描画する。
 * @returns 写真ライブラリ画面全体の React 要素
 */
export function App() {
  const [query, setQuery] = useState('')
  const [activeCollection, setActiveCollection] = useState('すべての写真')
  const [selected, setSelected] = useState<number | null>(1)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 検索語と選択中のコレクションの両方に一致する写真を求める。
   * 検索語は前後の空白を除き、大文字・小文字を区別せずに
   * タイトル・場所・タグと照合する。
   * @returns 表示対象の写真の配列
   */
  const visiblePhotos = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return photos.filter((photo) => {
      const matchesQuery = !normalized
        || [photo.title, photo.location, ...photo.tags].join(' ').toLowerCase().includes(normalized)
      const matchesCollection = activeCollection === 'すべての写真'
        || photo.tags.includes(activeCollection)
        || (activeCollection === 'お気に入り' && photo.id < 5)
        || (activeCollection === '2026 秋' && photo.id < 7)
      return matchesQuery && matchesCollection
    })
  }, [activeCollection, query])

  const selectedPhoto = photos.find((photo) => photo.id === selected) ?? visiblePhotos[0]

  /**
   * 表示するコレクションを切り替え、写真の選択を解除する。
   * @param name 表示するコレクション名。`すべての写真` のときは全写真を表示する
   */
  const chooseCollection = (name: string) => {
    setActiveCollection(name)
    setSelected(null)
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">⌁</span><span>snapnest</span></div>
        <button className="folder-button" onClick={() => setNotice('これはモックです。フォルダ選択は未実装です。')}>
          <span>＋</span> フォルダを開く
        </button>
        <nav>
          <p className="nav-label">ライブラリ</p>
          <button
            className={`nav-item ${activeCollection === 'すべての写真' ? 'active' : ''}`}
            onClick={() => chooseCollection('すべての写真')}
          >
            <span>▦</span> すべての写真 <b>246</b>
          </button>
          <button className="nav-item" onClick={() => setNotice('お気に入り表示は準備中です。')}>
            <span>♡</span> お気に入り <b>18</b>
          </button>
          <button className="nav-item muted" onClick={() => setNotice('参照切れの写真はありません。')}>
            <span>⌁</span> 再接続が必要 <b>0</b>
          </button>
          <div className="collections-heading">
            <p className="nav-label">コレクション</p>
            <button onClick={() => setNotice('コレクション作成は準備中です。')}>＋</button>
          </div>
          {collections.map(([name, count]) => (
            <button
              key={name}
              className={`nav-item collection ${activeCollection === name ? 'active' : ''}`}
              onClick={() => chooseCollection(name)}
            >
              <span className="dot" /> {name} <b>{count}</b>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /> すべて同期済み</div>
      </aside>

      <section className="library">
        <header className="topbar">
          <div><p className="eyebrow">ライブラリ</p><h1>{activeCollection}</h1></div>
          <div className="toolbar">
            <label className="search">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="写真を検索" />
            </label>
            <button className="icon-button" aria-label="並び替え">⇅</button>
            <button className="avatar">N</button>
          </div>
        </header>
        <div className="subbar">
          <span>{query ? `${visiblePhotos.length} 件の検索結果` : '2026年10月'}</span>
          <button onClick={() => setNotice('表示サイズの変更は準備中です。')}>▦ 表示</button>
        </div>
        {visiblePhotos.length ? (
          <div className="photo-grid">
            {visiblePhotos.map((photo) => (
              <button
                key={photo.id}
                className={`photo-card ${selectedPhoto?.id === photo.id ? 'selected' : ''}`}
                onClick={() => setSelected(photo.id)}
              >
                <div className={`thumbnail ${photo.kind} ${photo.tone}`}><span className="selection">✓</span></div>
                <div className="photo-caption">
                  <strong>{photo.title}</strong>
                  <span>{photo.date.replace('2026年', '')}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span>⌕</span>
            <h2>写真が見つからない</h2>
            <p>別のキーワードで試してみてください。</p>
          </div>
        )}
      </section>

      <aside className="inspector">
        {selectedPhoto && <>
          <div className={`inspector-image thumbnail ${selectedPhoto.kind} ${selectedPhoto.tone}`}>
            <span>⋯</span>
          </div>
          <div className="inspector-heading">
            <div><h2>{selectedPhoto.title}</h2><p>{selectedPhoto.date}</p></div>
            <button className="icon-button" aria-label="詳細メニュー">⋯</button>
          </div>
          <section className="detail-section">
            <p>保存場所</p>
            <div className="path">
              <span>▣</span>
              <div><strong>Pictures / 2026 / 10</strong><small>ローカルのフォルダを参照中</small></div>
            </div>
          </section>
          <section className="detail-section">
            <p>コレクション</p>
            <div className="chips">
              <button>散歩 <span>×</span></button>
              <button>2026 秋 <span>×</span></button>
              <button className="add-chip" onClick={() => setNotice('コレクション追加は準備中です。')}>
                ＋ 追加
              </button>
            </div>
          </section>
          <section className="detail-section">
            <p>詳細</p>
            <dl>
              <div><dt>場所</dt><dd>{selectedPhoto.location}</dd></div>
              <div><dt>形式</dt><dd>JPEG · 4.8 MB</dd></div>
              <div><dt>サイズ</dt><dd>4,032 × 3,024</dd></div>
            </dl>
          </section>
          <p className="privacy-note">
            この写真は端末内にあります。snapnest は原本をアップロードしません。
          </p>
        </>}
      </aside>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}
    </main>
  )
}
