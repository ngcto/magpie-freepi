// The account's model list, from the public catalog (§2.2).
//
// The models hook asks the catalog at the base the plugin was built with, so
// this file points that at the mock: no test here ever reaches api.freepi.ai.
import { test, expect, beforeAll, afterAll } from "bun:test"
import { startMock } from "./mock-freepi.mjs"
import { providerConfig, modelsHook, labelOf } from "../lib/provider.mjs"

let mock
const env = process.env.FREEPI_BASE_URL
const provider = providerConfig()
const account = { type: "oauth", access: "header.payload.signature", refresh: "" }

beforeAll(() => {
  mock = startMock()
  process.env.FREEPI_BASE_URL = mock.url
})

afterAll(() => {
  if (env === undefined) delete process.env.FREEPI_BASE_URL
  else process.env.FREEPI_BASE_URL = env
  mock.close()
})

test("the catalog's models become the account's models", async () => {
  const models = await modelsHook()(provider, { auth: account })
  expect(Object.keys(models)).toEqual([
    "deepseek-v4-flash",
    "deepseek-v4.1-flash",
    "deepseek-v4.1-flash-1017-ultrafast",
    "gpt-6.2-astra",
  ])
})

test("a free model is free, and a model with a multiplier carries its rate", async () => {
  const models = await modelsHook()(provider, { auth: account })
  expect(models["deepseek-v4-flash"].free).toBe(true)
  expect(models["deepseek-v4-flash"].rate).toBeUndefined()
  expect(models["gpt-6.2-astra"].rate).toBe(51)
  expect(models["deepseek-v4.1-flash-1017-ultrafast"].rate).toBe(1.6)
})

test("the defense section is behind this plugin's own opt-in", async () => {
  const off = await modelsHook()(provider, { auth: account })
  expect(off["abliterated-large-v2"]).toBeUndefined()
  const on = await modelsHook({ defense: true })(provider, { auth: account })
  expect(on["abliterated-large-v2"].rate).toBe(60)
})

test("a model the vendor marks unavailable is not offered", async () => {
  const models = await modelsHook()(provider, { auth: account })
  expect(models["gone-model"]).toBeUndefined()
})

test("every model keeps FreePi's own limits and tools", async () => {
  const models = await modelsHook()(provider, { auth: account })
  const m = models["gpt-6.2-astra"]
  expect(m.limit).toEqual({ context: 200000, output: 32768 })
  expect(m.tool_call).toBe(true)
  expect(m.name).toBe("GPT-6.2 Astra") // the marketing line is gone
})

test("a catalog that can't be read keeps the list magpie had", async () => {
  mock.close()
  const models = await modelsHook()(provider, { auth: account })
  expect(models).toBe(provider.models)
  mock = startMock() // for afterAll
  process.env.FREEPI_BASE_URL = mock.url
})

test("unsigned in, the declared model stands", async () => {
  const models = await modelsHook()(provider, { auth: undefined })
  expect(models).toBe(provider.models)
})

test("labelOf prefers the vendor's display name", () => {
  expect(labelOf({ id: "x", name: "Thing · 🔥 Free Unlimited", display_name: "Thing" })).toBe("Thing")
  expect(labelOf({ id: "x", name: "Thing · more" })).toBe("Thing")
  expect(labelOf({ id: "x" })).toBe("x")
})
