// The provider magpie lists, and the models each account has.
//
// FreePi has no /v1/models: the catalog is the public GET /client-version
// (§2.2), which also carries each model's `usage_x` allowance multiplier. magpie
// shows that multiplier on the model and uses it where a rate matters, so a
// person can see that a defense model costs 60x a cheap one.

import { MODEL_LIMITS, PROVIDER_ID, PROVIDER_NAME, baseUrl } from "./contract.mjs"
import { catalog } from "./freepi.mjs"

// The model FreePi's server serves by default when the catalog can't be read.
const FALLBACK = { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }

export function providerConfig() {
  return {
    name: PROVIDER_NAME,
    npm: "@ai-sdk/openai-compatible",
    api: `${baseUrl()}/v1`,
    models: { [FALLBACK.id]: modelEntry(FALLBACK) },
  }
}

export function modelEntry(m) {
  return {
    name: labelOf(m),
    id: m.id,
    limit: { ...MODEL_LIMITS },
    tool_call: true,
    reasoning: false,
    modalities: { input: ["text"] },
    cost: { input: 0, output: 0 },
    ...(m.free === true ? { free: true } : {}),
    ...(typeof m.usage_x === "number" && m.usage_x > 0 ? { rate: m.usage_x } : {}),
  }
}

// labelOf is the name FreePi shows in its own picker, without the marketing
// line its `name` carries ("DeepSeek V4 Flash · 🔥 Free Unlimited: limited time").
export function labelOf(m) {
  const display = typeof m.display_name === "string" ? m.display_name.trim() : ""
  if (display) return display
  const name = typeof m.name === "string" ? m.name : ""
  const cut = name.split(" · ")[0].trim()
  return cut || String(m.id || "")
}

// listed keeps what can be called: a model marked unavailable is "show but
// reject", the defense section is behind the CLI's own opt-in, and `freeOnly`
// keeps only what FreePi's catalog marks free. Every decision comes from the
// catalog's own flags, never from a list of ids this plugin carries: FreePi
// calls its free models "limited time", so which ones they are changes without
// a release here.
//
// The two switches don't add up: no free model is a defense model, so `freeOnly`
// lists what it lists and `defense` has nothing to add to it. `null` means
// nothing was left; a caller decides what an empty listing means.
export function listed(models, { defense = false, freeOnly = false } = {}) {
  if (!Array.isArray(models)) return null
  const out = {}
  for (const m of models) {
    if (!m || typeof m.id !== "string" || !m.id) continue
    if (m.unavailable === true) continue
    if (freeOnly && m.free !== true) continue
    if (m.section === "defense" && !defense) continue
    out[m.id] = modelEntry(m)
  }
  return Object.keys(out).length ? out : null
}

// modelsHook takes the plugin's switches, read each time it runs, so turning
// one on reaches the next listing without a host restart.
export function modelsHook(switches = {}) {
  const on = (name) => (typeof switches[name] === "function" ? switches[name] : () => switches[name] === true)
  const defense = on("defense")
  const freeOnly = on("freeOnly")
  return async function models(provider, { auth } = {}) {
    const known = provider?.models ?? {}
    if (!auth?.access) return known
    let body
    try {
      body = await catalog()
    } catch {
      // No catalog is no evidence about what is free: magpie keeps the list it
      // had rather than this hook guessing at one.
      return known
    }
    const listedNow = listed(body?.models, { defense: defense(), freeOnly: freeOnly() })
    if (listedNow) return listedNow
    // The catalog answered and holds nothing that matches the switch. Say so
    // with an empty list: falling back to the paid models would be a switch
    // that lies about what it did.
    return freeOnly() ? {} : known
  }
}
