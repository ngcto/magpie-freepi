// What every completion carries, and that the reply streams through untouched
// (§3.1, §2.1 live).
import { test, expect, afterEach } from "bun:test"
import { startMock } from "./mock-freepi.mjs"
import { authHook } from "../lib/auth.mjs"

let mock
afterEach(() => mock?.close())

const account = (sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") => ({
  type: "oauth",
  access: "header.payload.signature",
  refresh: "",
  freepi: { sessionId, clientVersion: "0.6.25" },
})

async function send(mock, auth = account(), body = { model: "deepseek-v4-flash", stream: true, messages: [{ role: "user", content: "ping" }] }) {
  const hook = authHook({ base: mock.url })
  const options = await hook.loader(async () => auth)
  const res = await options.fetch(`${options.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { res, text: await res.text() }
}

test("a completion sends the bearer, the version, this account's session and a fresh turn", async () => {
  mock = startMock()
  await send(mock)
  const headers = mock.last("/v1/chat/completions").headers
  expect(headers.authorization).toBe("Bearer header.payload.signature")
  expect(headers["x-client-version"]).toBe("0.6.25")
  expect(headers["x-session-id"]).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
  expect(headers["x-turn-id"]).toMatch(/^[0-9a-f-]{36}$/)
  expect(headers.accept).toBe("text/event-stream")
})

test("the session id stays for the account; the turn id never repeats", async () => {
  mock = startMock()
  await send(mock)
  await send(mock)
  const [first, second] = mock.seen.filter((r) => r.path === "/v1/chat/completions")
  expect(first.headers["x-session-id"]).toBe(second.headers["x-session-id"])
  expect(first.headers["x-turn-id"]).not.toBe(second.headers["x-turn-id"])
})

test("nothing about ads is ever sent", async () => {
  mock = startMock()
  await send(mock)
  const headers = mock.last("/v1/chat/completions").headers
  expect(headers["x-ad-context"]).toBeUndefined()
  expect(headers["x-gravity-context"]).toBeUndefined()
})

test("the streamed reply comes back as FreePi sent it, usage chunk and all", async () => {
  mock = startMock()
  const { res, text } = await send(mock)
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  expect(text).toContain('"reasoning_content":"pondering"')
  expect(text).toContain('"content":"pong"')
  expect(text).toContain('"prompt_tokens":9')
  expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true)
})

test("a request that doesn't stream isn't dressed as one", async () => {
  mock = startMock()
  await send(mock, account(), { model: "deepseek-v4-flash", stream: false, messages: [{ role: "user", content: "ping" }] })
  // whatever the HTTP client sends, not a stream the caller never asked for
  expect(mock.last("/v1/chat/completions").headers.accept).not.toBe("text/event-stream")
})

test("the version sent is the catalog's latest, not one the plugin invented", async () => {
  mock = startMock()
  const hook = authHook({ base: mock.url })
  const options = await hook.loader(async () => account())
  expect(mock.last("/client-version")).toBeDefined()
  expect(options.headers["x-client-version"]).toBe("0.6.25")
})
