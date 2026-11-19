// Runs holt's startup config checks (holt-config.ts: platforms, licensing, bridge) against config.js, or
// HOLT_CONFIG, and exits without listening or connecting to anything. A hand edit that holt would refuse
// at startup fails here instead of crash-looping the services after a restart:
//
//   cd /opt/holt && npm run check-config && systemctl restart holt holt-chat holt-discord
//
// Exit 0 when the config loads, 1 when it does not. Prints the check that failed, never a config value.
// holt-deploy-root runs it before restarting anything.

import { defaultGuildWarnings } from './bridge-config.ts'
import { loadConfig } from './holt-config.ts'

try {
  const config = await loadConfig()
  for (const warning of defaultGuildWarnings(config.bridge)) console.warn(`[holt] ${warning}`)
  console.log(`[holt] config OK: ${config.platforms.map((p) => p.id).join(', ')}`)
} catch (error) {
  console.error('[holt] config refused:', error instanceof Error ? error.message : error)
  process.exit(1)
}
