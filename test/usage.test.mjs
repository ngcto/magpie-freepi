// The allowance, as magpie's Smart routing reads it (§4): one window with the
// day's used share, the server's own reset instant, and its span.
import { test, expect, afterEach } from "bun:test"
import { startMock } from "./mock-freepi.mjs"
import { authHook } from "../lib/auth.mjs"
import { usageFrom } from "../lib/usage.mjs"

let mock
afterEach(() => mock?.close())

const account = { type: "oauth", access: "header.payload.signature", refresh: "" }
const auth = async () => account

test("a fresh account reports its day as one window with nothing used", async () => {
  mock = startMock()
  const usage = await authHook({ base: mock.url }).usage(auth)
  expect(usage.plan).toBe("FreePi · young")
  expect(usage.user).toBe("ada")
  const day = usage.windows[0]
  expect(day.name).toBe("Today")
  expect(day.used).toBe(0) // 15000 of 15000 left is a reading, not "unknown"
  expect(day.amount).toBe(0)
  expect(day.limit).toBe(15000)
  expect(day.unit).toBe("credits")
  expect(day.resetsAt).toBe("2026-11-23T00:00:00.000Z") // the server's own reset
  expect(day.span).toBe(86400)
})

test("a spent account reports its share, which is what ranks it behind others", () => {
  const usage = usageFrom({
    handle: "ada",
    tier: "young",
    lane: "fallback",
    allowance_credits: 15000,
    remaining_credits_today: 3000,
    refill_at: "2026-11-23T00:00:00.000Z",
  })
  expect(usage.windows[0].used).toBe(80)
  expect(usage.windows[0].amount).toBe(12000)
})

test("a refused token marks the account as needing a sign-in", async () => {
  mock = startMock()
  const usage = await authHook({ base: mock.url }).usage(async () => ({ type: "oauth", access: "expired" }))
  expect(usage.signIn).toBe("expired")
  expect(usage.windows).toHaveLength(0)
  expect(usage.error).toContain("sign in again")
})

test("purchased credit is shown and set aside, so it never decides routing", () => {
  const usage = usageFrom({ allowance_credits: 15000, remaining_credits_today: 0, credit_usd: 3.75, refill_at: "2026-11-23T00:00:00.000Z" })
  const credit = usage.windows.find((w) => w.name === "Purchased credit")
  expect(credit.balance).toBe(3.75)
  expect(credit.unit).toBe("USD")
  expect(credit.aside).toBe(true)
  expect(usage.windows[0].used).toBe(100)
})

test("an allowance the vendor doesn't count falls back to the dollars it does", () => {
  const usage = usageFrom({ cap_usd_today: 2, remaining_usd_today: 0.5, refill_at: "2026-11-23T00:00:00.000Z" })
  const day = usage.windows[0]
  expect(day.unit).toBe("USD")
  expect(day.used).toBe(75)
})

test("a lane with no share says so in words instead of inventing a percentage", () => {
  const usage = usageFrom({ lane: "wait", refill_at: "2026-11-23T00:00:00.000Z" })
  expect(usage.windows[0]).toEqual({ name: "Today", display: "wait lane", resetsAt: "2026-11-23T00:00:00.000Z", span: 86400 })
  expect(usage.windows[0].used).toBeUndefined()
})
