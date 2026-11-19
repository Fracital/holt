import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { loadDecryptionKey } from '../lib/holy-decrypt'
import { HolyText } from '../components/common/HolyText'
import { App } from './App'
import { readPlatform } from './platform'
import { startProxySession } from './proxy-session'
import './embed.css'

// A chat platform gets the full chatbox; every other platform gets the identity shell (App).
const ChatMount = lazy(() => import('../chat-mount').then((module) => ({ default: module.ChatMount })))

loadDecryptionKey()

const root = createRoot(document.getElementById('root')!)
const platform = readPlatform()
// Sign the chatbox in with the platform's own login before it mounts.
const ready = platform?.chat ? startProxySession(platform.tokenStorageKey) : Promise.resolve()
void ready.then(() => root.render(
  <StrictMode>
    {platform?.chat ? (
      <Suspense fallback={null}>
        {/* Each site's chatbox opens on its home guild unless the visitor has a deep link or a last-used
            guild that is still listed (pages/chat/guildPick.ts); every bridged guild stays in the rail. */}
        <ChatMount homeGuild={platform.homeGuild} />
      </Suspense>
    ) : platform ? (
      <App platform={platform} />
    ) : (
      <HolyText as="p" className="holt-error" text="This site is not set up for chat." />
    )}
  </StrictMode>,
))
