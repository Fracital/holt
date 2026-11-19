// The `bridge` config key: one entry per platform (a licensed site), with its embed license and the Discord
// guild its chatbox belongs to, plus what is bridged from that guild.
//
//   bridge: {
//     abulxt:   { license: 'eyJ…', guild: '1548417587291881574', channels: ['…'], categories: [] },
//     lab:      { license: 'eyJ…', guild: '…', categories: ['…'] },
//     nocturne: { license: 'eyJ…' },                     // licensed, no guild yet
//     systemya: { license: 'eyJ…', defaultGuild: '…' },   // no guild of its own, opens another bridged guild
//   }
//
// - Licensing: when `bridge` is present, holt honours only the licenses listed here (license.ts checks the
//   signature, expiry and platform; this adds "is it registered"). Revoking = deleting the line. The
//   config is the register of who is licensed and which guild each site owns.
// - Bridging: replaces discord.bridgeChannels / discord.bridgeCategories (still read when `bridge` is
//   absent). Every listed channel or category must belong to the entry's guild; the bot skips any that
//   does not, so a typo can never pull another guild's channel into a site.
// - Each site's chatbox opens on its home guild (homeGuildFor): `defaultGuild` when set, else its own `guild`.
//   A deep link or the visitor's last-used guild (when still listed) wins over it; every bridged guild still
//   shows in the server rail. `defaultGuild` may be any bridged guild, so a site without a guild of its own
//   can open another site's; one that is not bridged is only a startup warning (defaultGuildWarnings).
//
// Pure: no I/O.

export interface BridgeEntry {
  platform: string
  /** The platform's embed license (a token), or null when the platform is not licensed here. */
  license: string | null
  guild: string | null
  /** The guild this platform's chatbox opens on when the visitor has none listed of their own, or null. */
  defaultGuild: string | null
  channels: string[]
  categories: string[]
}

export interface BridgeTargets {
  channelIds: string[]
  categoryIds: string[]
  /** channel or category id -> the guild it must belong to. Empty for legacy config (any guild). */
  expectedGuild: Map<string, string>
  /** guild id -> the platform that owns it. */
  guildPlatform: Map<string, string>
}

const SLUG = /^[a-z][a-z0-9-]{0,31}$/
const SNOWFLAKE = /^\d{15,22}$/

class BridgeConfigError extends Error {}

function fail(where: string, message: string): never {
  throw new BridgeConfigError(`bridge.${where}: ${message}`)
}

function snowflakes(where: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) fail(where, 'must be a list of ids')
  const out = new Set<string>()
  for (const value of raw) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!SNOWFLAKE.test(id)) fail(where, `${String(value)} is not a Discord id`)
    out.add(id)
  }
  return [...out]
}

/** The `bridge` key, validated. Null when it is absent (legacy discord.bridgeChannels/Categories apply). */
export function parseBridge(raw: unknown): BridgeEntry[] | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('', 'must be an object keyed by platform id')
  const entries: BridgeEntry[] = []
  const guildOwner = new Map<string, string>()
  const idOwner = new Map<string, string>()
  for (const [platform, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLUG.test(platform)) fail(platform, 'the key must be a platform id')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(platform, 'must be an object')
    const v = value as Record<string, unknown>
    const license = typeof v.license === 'string' && v.license.trim() ? v.license.trim() : null
    if (v.license !== undefined && v.license !== null && license === null) fail(`${platform}.license`, 'must be a license token')
    const guild = typeof v.guild === 'string' && v.guild.trim() ? v.guild.trim() : null
    if (v.guild !== undefined && v.guild !== null && (guild === null || !SNOWFLAKE.test(guild))) fail(`${platform}.guild`, 'must be a Discord guild id')
    const defaultGuild = typeof v.defaultGuild === 'string' && v.defaultGuild.trim() ? v.defaultGuild.trim() : null
    if (v.defaultGuild !== undefined && v.defaultGuild !== null && (defaultGuild === null || !SNOWFLAKE.test(defaultGuild))) fail(`${platform}.defaultGuild`, 'must be a Discord guild id')
    const channels = snowflakes(`${platform}.channels`, v.channels)
    const categories = snowflakes(`${platform}.categories`, v.categories)
    if ((channels.length || categories.length) && guild === null) fail(platform, 'channels and categories need the guild they belong to')
    if (guild !== null) {
      const owner = guildOwner.get(guild)
      if (owner !== undefined) fail(`${platform}.guild`, `guild ${guild} already belongs to ${owner}`)
      guildOwner.set(guild, platform)
    }
    for (const id of [...channels, ...categories]) {
      const owner = idOwner.get(id)
      if (owner !== undefined) fail(platform, `${id} is already bridged by ${owner}`)
      idOwner.set(id, platform)
    }
    entries.push({ platform, license, guild, defaultGuild, channels, categories })
  }
  return entries
}

/** What the bot bridges: from `bridge` when present, else the legacy discord.* lists (any guild). */
export function bridgeTargets(config: { bridge?: unknown; discord?: { bridgeChannels?: unknown; bridgeCategories?: unknown } }): BridgeTargets {
  const entries = parseBridge(config.bridge)
  if (entries === null) {
    const ids = (raw: unknown) => (Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()))] : [])
    return { channelIds: ids(config.discord?.bridgeChannels), categoryIds: ids(config.discord?.bridgeCategories), expectedGuild: new Map(), guildPlatform: new Map() }
  }
  const targets: BridgeTargets = { channelIds: [], categoryIds: [], expectedGuild: new Map(), guildPlatform: new Map() }
  for (const entry of entries) {
    if (entry.guild === null) continue
    targets.guildPlatform.set(entry.guild, entry.platform)
    for (const id of entry.channels) { targets.channelIds.push(id); targets.expectedGuild.set(id, entry.guild) }
    for (const id of entry.categories) { targets.categoryIds.push(id); targets.expectedGuild.set(id, entry.guild) }
  }
  return targets
}

/** A channel/category resolved by the bot is bridged only if it sits in the guild its entry names. */
export function inExpectedGuild(targets: BridgeTargets, id: string, actualGuild: string): boolean {
  const expected = targets.expectedGuild.get(id)
  return expected === undefined || expected === actualGuild
}

/** The guild a platform's chatbox opens on first: its `defaultGuild`, else its own `guild`, else null. */
export function homeGuildFor(entries: BridgeEntry[] | null, platform: string): string | null {
  const entry = entries?.find((e) => e.platform === platform)
  return entry ? entry.defaultGuild ?? entry.guild : null
}

/**
 * A `defaultGuild` that no entry bridges anything from never shows in any chatbox's rail, so the chatbox
 * opens its first listed guild instead. Not fatal (a guild may be bridged later), but logged at startup.
 */
export function defaultGuildWarnings(entries: BridgeEntry[] | null): string[] {
  const bridged = new Set((entries ?? []).filter((e) => e.guild !== null && (e.channels.length || e.categories.length)).map((e) => e.guild))
  return (entries ?? [])
    .filter((e) => e.defaultGuild !== null && !bridged.has(e.defaultGuild))
    .map((e) => `bridge.${e.platform}.defaultGuild: ${e.defaultGuild} is not a bridged guild (no bridge entry bridges channels from it); the chatbox opens its first listed guild instead`)
}

/** The licenses registered for one platform (null when `bridge` is absent: licensing is not registry-based). */
export function registeredLicenses(entries: BridgeEntry[] | null, platform: string): string[] | null {
  if (entries === null) return null
  const entry = entries.find((e) => e.platform === platform)
  return entry?.license ? [entry.license] : []
}
