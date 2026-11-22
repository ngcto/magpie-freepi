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
  expect(token.when).toEqual({ key: "terms", op: "eq", value: "token" })
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

test("both switches are declared, so magpie can show and set them", () => {
  const keys = plugin.auth.options.map((o) => o.key)
  expect(keys).toEqual(["free_only", "defense"])
  for (const sw of plugin.auth.options) {
    expect(sw.default).toBe(false)
    expect(sw.label).toBeTruthy()
    expect(typeof sw.description).toBe("string")
  }
  const [free, defense] = plugin.auth.options
  expect(free.description).toContain("limited time")
  expect(free.description).toContain("no models")
  expect(defense.description).toContain("20-60x")
  expect(defense.confirm).toContain("daily allowance")
})

test("magpie's option function turns a switch on; nothing else does", async () => {
  const { switchOn } = _internal
  expect(switchOn({ option: (_p, key) => key === "defense" }, "defense")).toBe(true)
  expect(switchOn({ option: (_p, key) => key === "free_only" }, "defense")).toBe(false)
  expect(switchOn({ option: () => false }, "defense")).toBe(false)
  expect(switchOn({ options: () => ({ defense: true }) }, "defense")).toBe(true) // an object-shaped host
  expect(switchOn(undefined, "defense")).toBe(false)
})

test("_internal carries the pieces a test needs, and no bare function", () => {
  for (const value of Object.values(_internal)) expect(typeof value).toBe("function")
  expect(_internal.authHook).toBeTypeOf("function")
})
