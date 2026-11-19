// node --test for the Twemoji <img> markup. Run with: npm test
//
// The embed page's CSP has no 'unsafe-inline' in script-src, so an inline event handler in this
// markup is blocked and reported as a violation on every message with an emoji. The 404 fallback is a
// document listener in twemoji.ts instead.

import test from 'node:test'
import assert from 'node:assert/strict'

import { twemojify, twemojiImg } from './twemoji.ts'

test('twemoji imgs carry no inline event handler', () => {
  const html = twemojify('hi \u{1F40D} and \u{1F468}‍\u{1F469}‍\u{1F467} ❤️')
  assert.equal((html.match(/<img\b/g) ?? []).length, 3)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.doesNotMatch(html, /javascript:/i)
})

test('twemoji imgs are marked for the 404 fallback and keep the glyph as alt', () => {
  const tag = twemojiImg('1f40d', '\u{1F40D}')
  assert.match(tag, /\sdata-twemoji-fallback[\s/>]/)
  assert.match(tag, /alt="\u{1F40D}"/u)
  assert.match(tag, /src="https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@16\.0\.1\/assets\/72x72\/1f40d\.png"/)
})

test('alt text is escaped', () => {
  const tag = twemojiImg('1f40d', '"><img src=x>&')
  assert.match(tag, /alt="&quot;>&lt;img src=x>&amp;"/)
})
