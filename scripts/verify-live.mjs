#!/usr/bin/env node
// Exercises the plugin against the real FreePi API, through the plugin's own
// code paths, with a token that already exists on this machine.
//
//   FREEPI_TOKEN=… node scripts/verify-live.mjs        (or: ~/.free-pi/agent/credentials.json)
//
// It signs nothing in and prints no credential: the token is read, used, and
// shown only as a fingerprint. Every step reports what it saw, and the last one
// forces an old x-client-version to prove the version gate is really there.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const BASE = process.env.FREEPI_BASE_URL || "https://api.freepi.ai"
const results = []
let failed = 0

function step(name, ok, note) {
  results.push({ name, ok, note })
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`)
}

function tokenFrom() {
  if (process.env.FREEPI_TOKEN) return { token: process.env.FREEPI_TOKEN.trim(), from: "$FREEPI_TOKEN" }
  const path = join(homedir(), ".free-pi", "agent", "credentials.json")
  try {
    const token = JSON.parse(readFileSync(path, "utf8"))?.token
    if (typeof token === "string" && token) return { token, from: path }
  } catch {}
  return null
}

const fingerprint = (t) => `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`

const found = tokenFrom()
if (!found) {
  console.error("No token: set FREEPI_TOKEN or sign in with free-pi-cli first.")
  process.exit(2)
}
console.log(`token from ${found.from}: ${fingerprint(found.token)}`)
console.log(`base ${BASE}\n`)

const { default: FreePiPlugin } = await import("../index.mjs")
const plugin = await FreePiPlugin({ client: {}, magpie: {} })

// The catalog is public: the client version the plugin reports comes from it.
let latest = ""
try {
  const res = await fetch(`${BASE}/client-version`)
  const body = await res.json()
  latest = body?.latest || ""
  step("catalog GET /client-version", res.ok, `${res.status} · ${body?.models?.length ?? 0} models · min ${body?.min} · latest ${latest}`)
} catch (err) {
  step("catalog GET /client-version", false, String(err))
}

// The account as magpie keeps it: this token, and one random session id.
const auth = {
  type: "oauth",
  access: found.token,
  refresh: "",
  freepi: { sessionId: crypto.randomUUID(), clientVersion: latest || "0.6.25" },
}
const getAuth = async () => auth

// 1. the sign-in state the plugin would have saved
step(
  "sign-in loaded",
  Boolean(auth.freepi.sessionId && auth.freepi.clientVersion),
  `session ${auth.freepi.sessionId.slice(0, 8)}… · client ${auth.freepi.clientVersion}`,
)

// 2 & 3. /me and the usage magpie's routing reads
let usage
try {
  usage = await plugin.auth.usage(getAuth)
  const day = usage.windows?.find((w) => w.name === "Today")
  step("usage GET /me", Boolean(day), day ? `${day.used}% used · ${day.amount}/${day.limit} ${day.unit} · resets ${day.resetsAt} · ${usage.plan}` : usage.error)
} catch (err) {
  step("usage GET /me", false, String(err))
}

// 4. the account's model list
try {
  const cfg = {}
  await plugin.config(cfg)
  const models = await plugin.provider.models(cfg.provider.freepi, { auth })
  const ids = Object.keys(models || {})
  const sample = ids.slice(0, 3).map((id) => `${id}${models[id].rate ? ` ×${models[id].rate}` : ""}`).join(", ")
  step("models from the catalog", ids.length > 0, `${ids.length} models: ${sample}…`)
} catch (err) {
  step("models from the catalog", false, String(err))
}

// 5. one streamed completion, through the loader's own fetch
try {
  const loader = await plugin.auth.loader(getAuth)
  const started = Date.now()
  const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      stream: true,
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
    }),
  })
  const text = await res.text()
  const frames = text.split("\n").filter((l) => l.startsWith("data: "))
  const content = frames.map((f) => f.slice(6)).filter((f) => f !== "[DONE]").map((f) => JSON.parse(f))
  const said = content.map((c) => c.choices?.[0]?.delta?.content || "").join("")
  const used = content.find((c) => c.usage)?.usage
  const ms = Date.now() - started
  step(
    "streamed chat completion",
    res.ok && said.trim().length > 0,
    `${res.status} · ${res.headers.get("content-type")} · ${frames.length} frames · ${ms} ms · said "${said.trim().slice(0, 40)}"` +
      (used ? ` · usage ${used.prompt_tokens}+${used.completion_tokens}` : " · no usage chunk"),
  )
} catch (err) {
  step("streamed chat completion", false, String(err))
}

// 6. the version gate, forced: an old x-client-version must be refused
try {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${found.token}`,
      "content-type": "application/json",
      "x-client-version": "0.1.0",
      "x-session-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ model: "deepseek-v4-flash", stream: false, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
  })
  const body = await res.text()
  step("426 path with x-client-version: 0.1.0", res.status === 426, `${res.status} · ${body.slice(0, 160).replace(/\s+/g, " ")}`)
} catch (err) {
  step("426 path with x-client-version: 0.1.0", false, String(err))
}

console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
