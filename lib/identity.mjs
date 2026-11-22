// The identity one FreePi account sends to the server.
//
// FreePi has no derived header: no signature, nonce, timestamp or fingerprint
// (§3.1). What it does key on is the bearer token, plus two ids the client
// picks itself: `x-session-id` (one per running client, and the server leases
// one live session per token) and `x-turn-id` (one per request). So the honest
// per-account identity is: this account's sign-in, one random session UUID
// minted at sign-in and held for the account's life, and a fresh turn UUID
// per request. Nothing is shared between accounts.

import { CLI_FLOOR, HEADERS } from "./contract.mjs"

export function randomId() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// identityOf is the account's identity, minting the session id the first time
// it is asked for. A sign-in always keeps one, so a minted one is only a
// repair for an account signed in before this plugin had it.
export function identityOf(auth) {
  const saved = auth?.freepi
  const session = typeof saved?.sessionId === "string" && saved.sessionId.length >= 8 ? saved.sessionId : ""
  const version = typeof saved?.clientVersion === "string" && saved.clientVersion ? saved.clientVersion : ""
  return { sessionId: session || randomId(), clientVersion: version || CLI_FLOOR }
}

export function identityOn(auth, { sessionId, clientVersion } = {}) {
  const now = identityOf(auth)
  return {
    sessionId: sessionId || now.sessionId,
    clientVersion: clientVersion || now.clientVersion,
  }
}

// tokenExpiry is when the sign-in ends, read from the token's own `exp` claim
// (live: a JWT with sub/iat/exp, 90 days). It is a fact the vendor publishes,
// not a guess: a token this can't read is one magpie never renews.
export function tokenExpiry(token) {
  const parts = typeof token === "string" ? token.split(".") : []
  if (parts.length !== 3) return 0
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    const exp = JSON.parse(json)?.exp
    return typeof exp === "number" && exp > 0 ? exp * 1000 : 0
  } catch {
    return 0
  }
}

// headersOf is what every completion carries beside its bearer token. The
// turn id is fresh for each request so the server can join a request with what
// happened in it; the session id stays for the account's life.
export function headersOf(auth, { turnId } = {}) {
  const id = identityOf(auth)
  return {
    [HEADERS.session]: id.sessionId,
    [HEADERS.turn]: turnId || randomId(),
    [HEADERS.version]: id.clientVersion,
  }
}
