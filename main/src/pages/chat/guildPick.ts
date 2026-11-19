/* Which guild the chatbox opens, and when that counts as the visitor's
 * last-used guild.
 *
 * When no listed guild is open (first load, or the open one vanished), the
 * chatbox opens the deep-link target, else the last-used guild, else the
 * site's home guild (bridge.<platform>.defaultGuild, else its own guild;
 * holt-service puts it in the embed page), else the first listed. Each
 * candidate counts only while it is listed.
 *
 * Only a choice the visitor made is remembered: a server clicked in the rail,
 * a channel or message opened in another server, or a deep link they
 * followed. Opening a guild automatically never writes, so the home guild
 * keeps applying until the visitor picks something else.
 *
 * The key is holt's own. The old 'abulxt:chat-last-guild' was written on
 * every open, automatic ones included, so it says nothing about a choice and
 * is never read (it is left in place, unused). Storage that throws (blocked,
 * private mode) reads as nothing remembered and drops writes. */

export const LAST_GUILD_KEY = 'holt:chat-last-guild'

type GuildStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): GuildStorage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function readLastGuild(storage: GuildStorage | null = browserStorage()): string | null {
  try { return storage?.getItem(LAST_GUILD_KEY) || null } catch { return null }
}

/** The visitor picked this guild: remember it as their last-used guild. */
export function rememberGuild(guildId: string, storage: GuildStorage | null = browserStorage()): void {
  try { storage?.setItem(LAST_GUILD_KEY, guildId) } catch { /* storage blocked */ }
}

/** The guild to open (null for an empty list). Remembers it only when it is the deep link's. */
export function openingGuild(listed: readonly string[], linkGuild: string | null, homeGuild: string | null, storage: GuildStorage | null = browserStorage()): string | null {
  if (linkGuild && listed.includes(linkGuild)) {
    rememberGuild(linkGuild, storage)
    return linkGuild
  }
  for (const id of [readLastGuild(storage), homeGuild]) if (id && listed.includes(id)) return id
  return listed[0] ?? null
}
