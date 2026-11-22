// The plugin's switches, against a catalog that can change: which models are
// free is FreePi's word and its own moving target, so nothing here may come
// from a list this plugin carries.
import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { startMock } from "./mock-freepi.mjs"
import { providerConfig, modelsHook } from "../lib/provider.mjs"

let mock
const env = process.env.FREEPI_BASE_URL
const provider = providerConfig()
const account = { type: "oauth", access: "header.payload.signature", refresh: "" }

const FREE = [
  { id: "particle", name: "Particle-1 · 🔥 Free Unlimited: limited time", display_name: "Particle-1", free: true, usage_x: null },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash · 🔥 Free Unlimited: limited time", display_name: "DeepSeek V4 Flash", free: true, usage_x: null },
]
const PAID = [
  { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", display_name: "GPT-6.2 Astra", usage_x: 51 },
  { id: "hy4-flash", name: "HY4 Flash", display_name: "HY4 Flash", usage_x: 0.2 },
]
const DEFENSE = [{ id: "abliterated-large-v2", name: "Abliterated Large V2", display_name: "Abliterated Large V2", usage_x: 60, section: "defense" }]
const GONE = [{ id: "gone-model", name: "Gone Model", display_name: "Gone Model", unavailable: true }]

const catalog = { min: "0.6.21", latest: "0.6.25", models: [...FREE, ...PAID, ...DEFENSE, ...GONE] }

beforeAll(() => {
  mock = startMock({ catalog })
  process.env.FREEPI_BASE_URL = mock.url
})

beforeEach(() => {
  catalog.models = [...FREE, ...PAID, ...DEFENSE, ...GONE]
})

afterAll(() => {
  if (env === undefined) delete process.env.FREEPI_BASE_URL
  else process.env.FREEPI_BASE_URL = env
  mock.close()
})

const ids = async (switches) => Object.keys(await modelsHook(switches)(provider, { auth: account }))

test("neither switch lists every model FreePi offers, minus the ones it rejects", async () => {
  expect(await ids({})).toEqual(["particle", "deepseek-v4-flash", "gpt-6.2-astra", "hy4-flash"])
})

test("free_only lists only what the catalog marks free", async () => {
  expect(await ids({ freeOnly: true })).toEqual(["particle", "deepseek-v4-flash"])
})

test("defense adds the defense section", async () => {
  expect(await ids({ defense: true })).toEqual(["particle", "deepseek-v4-flash", "gpt-6.2-astra", "hy4-flash", "abliterated-large-v2"])
})

test("the two don't add up: with both, the free models are the list", async () => {
  expect(await ids({ defense: true, freeOnly: true })).toEqual(await ids({ freeOnly: true }))
})

test("when nothing is free the list is empty, never the paid one behind a lie", async () => {
  catalog.models = [...FREE.map((m) => ({ ...m, free: false })), ...PAID]
  const models = await modelsHook({ freeOnly: true })(provider, { auth: account })
  expect(models).toEqual({})
})

test("the filter reads the catalog each time, not a snapshot", async () => {
  expect(await ids({ freeOnly: true })).toEqual(["particle", "deepseek-v4-flash"])
  catalog.models = [...FREE.map((m) => ({ ...m, free: false })), ...PAID]
  expect(await ids({ freeOnly: true })).toEqual([]) // particle and flash lost their free mark
  catalog.models = [...FREE, ...PAID]
  expect(await ids({ freeOnly: true })).toEqual(["particle", "deepseek-v4-flash"])
})

test("turning a switch on needs no restart: it is read per call", async () => {
  let freeOnly = false
  const watched = modelsHook({ freeOnly: () => freeOnly })
  expect(Object.keys(await watched(provider, { auth: account }))).toHaveLength(4)
  freeOnly = true
  expect(Object.keys(await watched(provider, { auth: account }))).toEqual(["particle", "deepseek-v4-flash"])
})

test("a catalog that can't be read is no evidence, so the list magpie had stands", async () => {
  mock.close()
  const models = await modelsHook({ freeOnly: true })(provider, { auth: account })
  expect(models).toBe(provider.models)
  mock = startMock({ catalog })
  process.env.FREEPI_BASE_URL = mock.url
})
