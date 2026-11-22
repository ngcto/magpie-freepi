// Signing in, end to end, against the mock: consent first, then FreePi's connect
// flow, then the token checked against /me. Plus the two ways a sign-in can go
// sideways (a declined consent, a server with no connect flow).
import { test, expect, afterEach } from "bun:test"
import { startMock } from "./mock-freepi.mjs"
import { authHook } from "../lib/auth.mjs"

let mock
afterEach(() => mock?.close())

function signIn(mock, inputs = { terms: "browser" }) {
  const hook = authHook({ base: mock.url })
  return hook.methods[0].authorize(inputs, {})
}

test("the connect flow ends with a token, a handle, and its own session id", async () => {
  mock = startMock()
  const started = await signIn(mock)
  expect(started.method).toBe("auto")
  expect(started.url).toContain("freepi.ai/connect")
  expect(started.instructions).toContain("P9ZJ-WMQ3")

  const account = await started.callback(undefined, {})
  expect(account.type).toBe("success")
  expect(account.access).toBe("header.payload.signature")
  expect(account.refresh).toBe("") // FreePi has no refresh token
  expect(account.accountId).toBe("11111111-2222-4333-8444-555555555555")
  expect(account.handle).toBe("ada")
  expect(account.freepi.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(account.freepi.clientVersion).toBe("0.6.25") // the catalog's latest
})

test("two accounts signed in get two session ids, never one", async () => {
  mock = startMock()
  const a = await (await signIn(mock)).callback(undefined, {})
  const b = await (await signIn(mock)).callback(undefined, {})
  expect(a.freepi.sessionId).not.toBe(b.freepi.sessionId)
  expect(a.access).toBe(b.access) // the mock's one token; the ids are still apart
})

test("a declined consent starts nothing", async () => {
  mock = startMock()
  const answer = await signIn(mock, { terms: "cancel" })
  expect(answer.type).toBe("failed")
  expect(answer.error).toContain("terms")
  expect(mock.seen).toHaveLength(0)
})

test("the pasted-token path checks the token before it keeps it", async () => {
  mock = startMock()
  const hook = authHook({ base: mock.url })
  const started = await hook.methods[0].authorize({ terms: "token", token: "header.payload.signature" }, {})
  const account = await started.callback(undefined, {})
  expect(account.type).toBe("success")
  expect(mock.last("/me").headers.authorization).toBe("Bearer header.payload.signature")
})

test("a token FreePi refuses is a failed sign-in that says why", async () => {
  mock = startMock()
  const hook = authHook({ base: mock.url })
  const started = await hook.methods[0].authorize({ terms: "token", token: "expired" }, {})
  const account = await started.callback(undefined, {})
  expect(account.type).toBe("failed")
  expect(account.error).toContain("FreePi refused the token")
})

test("a server with no connect flow falls back to the GitHub device flow", async () => {
  mock = startMock({ connect: false })
  const started = await signIn(mock)
  expect(started.url).toContain("github.com/login/device")
  expect(started.instructions).toContain("F0A9-23E3")
  expect(mock.last("/auth/consent").body.consent_version).toBe("4")

  const account = await started.callback(undefined, {})
  expect(account.type).toBe("success")
  expect(account.access).toBe("header.payload.signature")
})
