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
// reject", and the defense section is behind the CLI's own opt-in, so it is
// listed only when the person turned it on in this plugin's options.
export function listed(models, { defense = false } = {}) {
  if (!Array.isArray(models)) return null
  const out = {}
  for (const m of models) {
    if (!m || typeof m.id !== "string" || !m.id) continue
    if (m.unavailable === true) continue
    if (m.section === "defense" && !defense) continue
    out[m.id] = modelEntry(m)
  }
  return Object.keys(out).length ? out : null
}

export function modelsHook(options = {}) {
  return async function models(provider, { auth } = {}) {
    const known = provider?.models ?? {}
    if (!auth?.access) return known
    let body
    try {
      body = await catalog()
    } catch {
      return known // magpie keeps the list it had
    }
    return listed(body?.models, options) ?? known
  }
}
