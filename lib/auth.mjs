// The one way in: FreePi's own sign-in.
//
// FreePi issues a bearer token from a browser sign-in and nothing else: there
// is no API key to make, no refresh endpoint, and no expiry the vendor states
// (§1). magpie runs one method, so there is one button. Its first question is
// the consent FreePi requires to be recorded before a token is issued (§7), and
// its last is the choice of how the browser part happens: FreePi's connect page
// (the client only polls, so nothing has to reach this machine) or a token
// copied from a FreePi install that is already signed in — the escape hatch for
// a machine whose browser is somewhere else entirely.

import { CLI_FLOOR, CONSENT_SUMMARY, HEADERS, PROVIDER_ID, TERMS_URL, baseUrl } from "./contract.mjs"
import { headersOf, identityOf, identityOn, randomId, tokenExpiry } from "./identity.mjs"
import { catalog, me, pollForToken, signInFailure, startConnect, startDevice, submitConsent } from "./freepi.mjs"
import { usageFrom } from "./usage.mjs"

const VERSION_TTL = 10 * 60 * 1000

export function authHook({ client, base = baseUrl(), fetchImpl = fetch } = {}) {
  const version = versionWatcher({ base, fetchImpl })
  return {
    provider: PROVIDER_ID,
    // The plugin's switches. magpie shows each as a Plugin options toggle on
    // the provider and hands its value back through input.magpie.option.
    options: [
      {
        key: "free_only",
        label: "Free models only",
        description:
          "List only the models FreePi marks free in its own catalog. FreePi calls those \"limited time\", so which ones they are can change without this plugin noticing; if none are free, the provider lists no models rather than quietly showing the paid ones.",
        default: false,
      },
      {
        key: "defense",
        label: "FreePi's defense models",
        description:
          "List FreePi's defense section (the uncensored models) as well. They spend 20-60x the default model's allowance per request, and FreePi's own CLI keeps them behind an opt-in.",
        confirm:
          "FreePi's defense models cost 20-60 times the default model per request, which is 20-60 times as much of the daily allowance. List them?",
        default: false,
      },
    ],
    methods: [signInMethod({ base, fetchImpl, version })],
    loader: makeLoader({ client, base, version, fetchImpl }),
    usage: makeUsage({ base, fetchImpl, version }),
    // magpie asks this when the token is about to end. FreePi has no endpoint
    // that renews one (§1.1 step 4), so the honest answer is that it ended:
    // magpie marks the account and the person signs in again.
    async refresh() {
      throw Object.assign(new Error("FreePi's sign-in has ended; sign in again"), { signIn: "expired" })
    },
  }
}

function signInMethod({ base, fetchImpl, version }) {
  return {
    type: "oauth",
    label: "Sign in with FreePi",
    prompts: [
      {
        type: "select",
        key: "terms",
        message: `${CONSENT_SUMMARY} Continue only if you accept FreePi's terms (${TERMS_URL}).`,
        options: [
          { label: "I accept — sign in with a browser", value: "browser", hint: "opens freepi.ai" },
          { label: "I accept — paste a token instead", value: "token", hint: "~/.free-pi/agent/credentials.json" },
          { label: "Cancel", value: "cancel" },
        ],
      },
      {
        type: "password",
        key: "token",
        message: "The FreePi token from another machine's ~/.free-pi/agent/credentials.json",
        // op: "eq" is not optional. magpie's host negates a `when` that names no
        // op (`internal/plugin/host.js`: `prompt.when.op === "eq" ? !eq : eq`),
        // so without it this question is asked for every answer but "token".
        when: { key: "terms", op: "eq", value: "token" },
      },
    ],
    async authorize(inputs, { signal } = {}) {
      if (inputs?.terms === "cancel") {
        return { type: "failed", error: "FreePi's terms weren't accepted, so nothing was signed in" }
      }
      if (inputs?.terms === "token") {
        const token = String(inputs?.token ?? "").trim()
        if (!token) return { type: "failed", error: "No token was pasted" }
        return {
          url: "",
          instructions: "",
          method: "auto",
          callback: () => accountFromToken(token, { base, fetchImpl, version }),
        }
      }
      const started = await startFlow({ base, fetchImpl, signal })
      return {
        url: started.url,
        instructions: started.instructions,
        method: "auto",
        callback: (_code, { signal: later } = {}) =>
          pollForToken(started, { base, fetchImpl, signal: later }).then((token) =>
            accountFromToken(token, { base, fetchImpl, version, signal: later }),
          ),
      }
    },
  }
}

// startFlow opens FreePi's connect flow, and the GitHub device flow when the
// server has no connect flow (or refuses it): both issue the same kind of token
// and both end in a poll, so one method still covers a machine with no browser
// story and a server that predates connect.
async function startFlow({ base, fetchImpl, signal }) {
  try {
    const started = await startConnect({ base, fetchImpl })
    return {
      ...started,
      url: started.connectUrl,
      instructions: `Approve the sign-in in your browser${started.confirmCode ? `, confirming the code ${started.confirmCode}` : ""}. This window finishes on its own.`,
    }
  } catch (err) {
    if (signal?.aborted) throw err
  }
  const device = await startDevice({ base, fetchImpl })
  await submitConsent(device, { base, fetchImpl })
  return {
    ...device,
    url: device.verifyUrl,
    instructions: `Enter the code ${device.userCode} on the page that opened. This window finishes on its own.`,
  }
}

// accountFromToken is a sign-in's end: the token checked against /me, the
// vendor's current client version taken from the public catalog, and one random
// session id minted for this account alone (§3.3).
async function accountFromToken(token, { base, fetchImpl, version, signal }) {
  const { res, body } = await me(token, {
    base,
    fetchImpl,
    headers: { [HEADERS.version]: await version.current() },
    signal,
  })
  if (!res.ok) {
    const err = signInFailure(res, body, "FreePi refused the token")
    return { type: "failed", error: err.message }
  }
  const clientVersion = (await version.current()) || CLI_FLOOR
  return {
    type: "success",
    refresh: "", // FreePi issues no refresh token; the JWT's own exp is the end
    access: token,
    expires: tokenExpiry(token),
    accountId: typeof body?.user_id === "string" ? body.user_id : undefined,
    ...(typeof body?.handle === "string" && body.handle ? { handle: body.handle } : {}),
    freepi: identityOn(null, { sessionId: randomId(), clientVersion }),
  }
}

function makeLoader({ client, base, version, fetchImpl = fetch }) {
  return async function loader(getAuth) {
    const auth = await getAuth()
    const token = typeof auth?.access === "string" ? auth.access : ""
    if (!token) return {}
    const known = auth?.freepi
    const identity = identityOf(auth)
    if (!known?.sessionId && client?.auth?.set) {
      // an account signed in before this plugin kept an identity: give it one,
      // once, so its session stays its own
      await client.auth.set({ path: { id: PROVIDER_ID }, body: { ...auth, freepi: identity } }).catch(() => {})
    }
    const clientVersion = await version.current()
    return {
      baseURL: `${base}/v1`,
      headers: { [HEADERS.version]: clientVersion },
      async fetch(input, init = {}) {
        const headers = new Headers(init?.headers)
        headers.set("authorization", `Bearer ${token}`)
        for (const [name, value] of Object.entries(headersOf(auth))) headers.set(name, value)
        headers.set(HEADERS.version, clientVersion)
        if (!headers.has("accept") && streams(init?.body)) headers.set("accept", "text/event-stream")
        return fetchImpl(input, { ...init, headers })
      },
    }
  }
}

function streams(body) {
  return typeof body === "string" && /"stream"\s*:\s*true/.test(body)
}

function makeUsage({ base, fetchImpl, version }) {
  return async function usage(getAuth) {
    const auth = await getAuth()
    const token = typeof auth?.access === "string" ? auth.access : ""
    if (!token) return { windows: [], error: "FreePi isn't signed in on this account" }
    const { res, body } = await me(token, {
      base,
      fetchImpl,
      headers: { [HEADERS.version]: await version.current() },
    })
    if (res.status === 401) {
      return { windows: [], error: "FreePi refused the sign-in; sign in again", signIn: "expired" }
    }
    if (!res.ok) return { windows: [], error: `FreePi answered ${res.status}` }
    return usageFrom(body)
  }
}

// versionWatcher is the client version the plugin reports. The server refuses
// anything under the catalog's `min` (426), so the value is the catalog's own
// `latest`, read again when it is older than ten minutes — never a version the
// plugin made up.
function versionWatcher({ base, fetchImpl, ttl = VERSION_TTL, now = Date.now }) {
  let held = { value: "", at: 0 }
  let inFlight = null
  const read = async () => {
    try {
      const body = await catalog({ base, fetchImpl })
      const latest = typeof body?.latest === "string" && body.latest ? body.latest : ""
      if (latest) held = { value: latest, at: now() }
    } catch {}
    return held.value || CLI_FLOOR
  }
  return {
    async current() {
      if (held.value && now() - held.at < ttl) return held.value
      if (!inFlight) inFlight = read().finally(() => (inFlight = null))
      return inFlight
    },
  }
}
