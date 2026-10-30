import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'

/**
 * `_headers` から CSP を取り出し、ディレクティブごとの値に分ける。
 * @param text `_headers` の内容
 * @returns ディレクティブ名ごとの値
 */
const parseCsp = (text: string) => {
  const line = text.split('\n').find((item) => item.trim().startsWith('Content-Security-Policy:'))
  const policy = line?.split(':').slice(1).join(':') ?? ''
  return new Map(policy.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [name, ...values] = item.split(/\s+/)
    return [name, values] as const
  }))
}

describe('Content-Security-Policy', () => {
  const csp = parseCsp(headers)

  it('指定のないものは何も許可しない', () => {
    expect(csp.get('default-src')).toEqual(["'none'"])
  })

  it('通信は自分のサイトとだけ行える', () => {
    expect(csp.get('connect-src')).toEqual(["'self'"])
  })

  it('外部のサイトは Google Fonts のスタイルとフォントだけを許可する', () => {
    const external = [...csp].flatMap(([name, values]) => (
      values.filter((value) => value.startsWith('https:') || value.includes('.')).map((value) => `${name} ${value}`)
    ))
    expect(external).toEqual(['style-src https://fonts.googleapis.com', 'font-src https://fonts.gstatic.com'])
  })

  it('画像は自分のサイトと blob: の URL からだけ表示できる', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'blob:'])
  })

  it('ほかのサイトに埋め込ませず、フォームの送信先も持たない', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.get('form-action')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'none'"])
  })
})
