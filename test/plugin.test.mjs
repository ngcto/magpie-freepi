// The plugin as magpie loads it: the hooks it returns, and the provider they
// declare (usemagpie.ai/docs/plugins — "What the module exports", "Declaring the
// provider").
import { test, expect } from "bun:test"
import FreePiPlugin, { _internal } from "../index.mjs"

const plugin = await FreePiPlugin({ client: {}, magpie: {} })

test("the entry exports one plugin function and nothing magpie would call", () => {
  expect(typeof FreePiPlugin).toBe("function")
  expect(plugin).toHaveProperty("config")
  expect(plugin).toHaveProperty("auth")
  expect(plugin).toHaveProperty("provider")
})

test("config declares freepi, chat completions at FreePi's /v1", async () => {
  const cfg = {}
  await plugin.config(cfg)
  const provider = cfg.provider.freepi
  expect(provider.name).toBe("FreePi")
  expect(provider.npm).toBe("@ai-sdk/openai-compatible")
  expect(provider.api).toBe("https://api.freepi.ai/v1")
  expect(Object.keys(provider.models).length).toBeGreaterThan(0)
})

test("config leaves a provider the user configured alone", async () => {
  const mine = { name: "Mine", api: "https://example.test/v1", models: {} }
  const cfg = { provider: { freepi: mine } }
  await plugin.config(cfg)
  expect(cfg.provider.freepi).toBe(mine)
})

test("one sign-in method, and it is the browser one", () => {
  expect(plugin.auth.provider).toBe("freepi")
  expect(plugin.auth.methods).toHaveLength(1)
  expect(plugin.auth.methods[0].type).toBe("oauth")
  expect(plugin.auth.methods[0].label).toBe("Sign in with FreePi")
})

test("the sign-in asks for consent before it starts, in plain words", () => {
  const [terms, token] = plugin.auth.methods[0].prompts
  expect(terms.key).toBe("terms")
  expect(terms.message).toContain("train")
  expect(terms.message).toContain("https://freepi.ai/terms")
  expect(terms.options.map((o) => o.value)).toEqual(["browser", "token", "cancel"])
  expect(token.when).toEqual({ key: "terms", value: "token" })
})

test("magpie's own hooks are there: loader, usage, refresh, models", async () => {
  expect(typeof plugin.auth.loader).toBe("function")
  expect(typeof plugin.auth.usage).toBe("function")
  expect(typeof plugin.auth.refresh).toBe("function")
  expect(plugin.provider.id).toBe("freepi")
  expect(typeof plugin.provider.models).toBe("function")
})

test("refresh says the sign-in ended rather than pretending to renew it", async () => {
  await expect(plugin.auth.refresh({ type: "oauth" }, { id: "freepi" })).rejects.toMatchObject({
    signIn: "expired",
  })
})

test("the one switch is declared, so magpie can show and set it", () => {
  const [sw] = plugin.auth.options
  expect(sw.key).toBe("defense")
  expect(sw.default).toBe(false)
  expect(sw.label).toBeTruthy()
  expect(sw.description).toContain("20-60x")
  expect(sw.confirm).toContain("daily allowance")
})

test("magpie's option function turns it on; nothing else does", async () => {
  const { defenseOn } = _internal
  expect(defenseOn({ option: (_p, key) => key === "defense" })).toBe(true)
  expect(defenseOn({ option: () => false })).toBe(false)
  expect(defenseOn({ options: () => ({ defense: true }) })).toBe(true) // an object-shaped host
  expect(defenseOn(undefined)).toBe(false)
})

test("_internal carries the pieces a test needs, and no bare function", () => {
  for (const value of Object.values(_internal)) expect(typeof value).toBe("function")
  expect(_internal.authHook).toBeTypeOf("function")
})
