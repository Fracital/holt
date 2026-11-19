// node --test for the chatbox's opening guild and what counts as the last-used one. Run with: npm test

import test from 'node:test'
import assert from 'node:assert/strict'

import { LAST_GUILD_KEY, openingGuild, readLastGuild, rememberGuild } from './guildPick.ts'

const ABULXT = '1548417587291881574', FRACITAL = '1568402496848666636', OTHER = '1600000000000000001'
const GONE = '1700000000000000000'
const LIST = [ABULXT, OTHER, FRACITAL]

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, String(v)) } }
}

test('a site with a home guild opens it when the visitor has nothing of their own', () => {
  assert.equal(openingGuild(LIST, null, FRACITAL, memoryStorage()), FRACITAL)
})

test('a deep link, then the last-used guild, win over the home guild', () => {
  assert.equal(openingGuild(LIST, OTHER, FRACITAL, memoryStorage({ [LAST_GUILD_KEY]: ABULXT })), OTHER)
  assert.equal(openingGuild(LIST, null, FRACITAL, memoryStorage({ [LAST_GUILD_KEY]: ABULXT })), ABULXT)
})

test('a candidate that is no longer listed is skipped', () => {
  assert.equal(openingGuild(LIST, GONE, FRACITAL, memoryStorage({ [LAST_GUILD_KEY]: GONE })), FRACITAL, 'stale link and last-used guild')
  assert.equal(openingGuild([ABULXT, OTHER], null, FRACITAL, memoryStorage()), ABULXT, 'a home guild the visitor cannot see')
})

test('no home guild: the first listed guild', () => {
  assert.equal(openingGuild(LIST, null, null, memoryStorage()), ABULXT)
  assert.equal(openingGuild(LIST, null, null, memoryStorage({ [LAST_GUILD_KEY]: GONE })), ABULXT)
  assert.equal(openingGuild([], null, FRACITAL, memoryStorage({ [LAST_GUILD_KEY]: ABULXT })), null)
})

test('opening a guild automatically writes nothing', () => {
  for (const [home, expected] of [[FRACITAL, FRACITAL], [null, ABULXT]]) {
    const storage = memoryStorage()
    assert.equal(openingGuild(LIST, null, home, storage), expected)
    assert.equal(storage.map.size, 0, 'home guild or first listed is not a choice')
  }
  const storage = memoryStorage({ [LAST_GUILD_KEY]: OTHER })
  openingGuild(LIST, null, FRACITAL, storage)
  assert.deepEqual([...storage.map], [[LAST_GUILD_KEY, OTHER]], 'reopening the last-used guild leaves it as it was')
})

test('an explicit pick, or a deep link the visitor followed, is remembered', () => {
  const storage = memoryStorage()
  rememberGuild(OTHER, storage)
  assert.equal(readLastGuild(storage), OTHER)
  assert.equal(openingGuild(LIST, null, FRACITAL, storage), OTHER, 'the pick wins over the home guild next time')
  assert.equal(openingGuild(LIST, ABULXT, FRACITAL, storage), ABULXT)
  assert.equal(readLastGuild(storage), ABULXT, 'the deep link is remembered')
  const unlisted = memoryStorage()
  openingGuild(LIST, GONE, FRACITAL, unlisted)
  assert.equal(unlisted.map.size, 0, 'a deep link to a guild not listed is not remembered')
})

test('the old abulxt key is ignored, so its automatic values stop deciding', () => {
  const storage = memoryStorage({ 'abulxt:chat-last-guild': ABULXT })
  assert.equal(readLastGuild(storage), null)
  assert.equal(openingGuild(LIST, null, FRACITAL, storage), FRACITAL, 'an existing systemya visitor lands on the default')
  assert.equal(storage.map.get('abulxt:chat-last-guild'), ABULXT, 'left in place, never rewritten')
  assert.equal(LAST_GUILD_KEY.startsWith('abulxt:'), false)
})

test('storage that throws reads as nothing remembered and drops writes', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(readLastGuild(broken), null)
  assert.doesNotThrow(() => rememberGuild(OTHER, broken))
  assert.equal(openingGuild(LIST, OTHER, FRACITAL, broken), OTHER)
  assert.equal(openingGuild(LIST, null, FRACITAL, null), FRACITAL)
})
