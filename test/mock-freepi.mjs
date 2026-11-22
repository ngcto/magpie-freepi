// A stand-in for api.freepi.ai, so the plugin can be run end to end without a
// FreePi account. It answers the shapes the crew spec captured: the connect
// flow, the GitHub device flow, /me, /client-version, and a streamed chat
// completion whose last data chunk carries the usage.

const CATALOG = {
  min: "0.6.21",
  latest: "0.6.25",
  default_model: "deepseek-v4-flash",
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash · 🔥 Free Unlimited: limited time", display_name: "DeepSeek V4 Flash", free: true, usage_x: null },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", display_name: "DeepSeek V4.1 Flash", free: true, usage_x: null },
    { id: "deepseek-v4.1-flash-1017-ultrafast", name: "DeepSeek V4.1 Flash 600tps", display_name: "DeepSeek V4.1 Flash 600tps", usage_x: 1.6 },
    { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", display_name: "GPT-6.2 Astra", usage_x: 51 },
    { id: "abliterated-large-v2", name: "Abliterated Large V2", display_name: "Abliterated Large V2", usage_x: 60, section: "defense" },
    { id: "gone-model", name: "Gone Model", display_name: "Gone Model", unavailable: true },
  ],
}

const ME = {
  user_id: "11111111-2222-4333-8444-555555555555",
  handle: "ada",
  remaining_usd_today: 1.125,
  cap_usd_today: 1.125,
  tier: "young",
  credit_usd: 0,
  consent_version: "4",
  allowance_credits: 15000,
  remaining_credits_today: 15000,
  refill_at: "2026-11-23T00:00:00.000Z",
  lane: "standard",
  bonus_credits: 0,
}

const TOKEN = "header.payload.signature"

export function startMock({ connect = true, port = 0, free = true, catalog: override = null } = {}) {
  const seen = []
  let polls = 0
  let devicePolls = 0
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname
      const body = req.method === "POST" ? await req.json().catch(() => null) : null
      seen.push({ path, headers: Object.fromEntries(req.headers), body })
      const json = (data, status = 200) => Response.json(data, { status })
      const bearer = req.headers.get("authorization") || ""

      if (path === "/client-version") {
        if (override) return json(override)
        // `free: false` serves a catalog where the promotion has ended
        return json({ ...CATALOG, models: CATALOG.models.map((m) => (free ? m : { ...m, free: false })) })
      }

      if (path === "/auth/connect/start") {
        if (!connect) return new Response("404 Not Found", { status: 404 })
        if (req.headers.get("x-freepi-signin-exp") !== "1") return json({ code: "bad_request" }, 400)
        return json({
          session_id: "21df4e70-e2e6-4df1-8d1c-752c828e6e4b",
          poll_secret: "uvwS0apHI97g1fN_VywiTZL4VfeJvFYGmd4Ua1_AvhQ",
          token: "1DAVWBCWgC-yF-GtjoIw0TX7VyLUeJh1eRqr5wEASco",
          confirm_code: "P9ZJ-WMQ3",
          connect_url: "https://freepi.ai/connect#t=1DAVWBCWgC-yF-GtjoIw0TX7VyLUeJh1eRqr5wEASco",
          expires_in: 600,
          interval: 1,
        })
      }

      if (path === "/auth/connect/poll") {
        if (body?.poll_secret !== "uvwS0apHI97g1fN_VywiTZL4VfeJvFYGmd4Ua1_AvhQ") {
          return json({ code: "not_found", message: "unknown session" }, 404)
        }
        polls += 1
        if (polls < 2) return json({ status: "pending", opened: true })
        return json({ token: TOKEN })
      }

      if (path === "/auth/github/device") {
        return json({
          session_id: "e5de3014-22bb-4419-b0f0-371a12d90045",
          user_code: "F0A9-23E3",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 899,
          verification_uri_complete: "https://github.com/login/device?user_code=F0A9-23E3",
        })
      }

      if (path === "/auth/consent") {
        return json({ ok: true })
      }

      if (path === "/auth/token") {
        devicePolls += 1
        if (devicePolls < 2) return json({ status: "pending" })
        return json({ token: TOKEN })
      }

      if (path === "/me") {
        if (!bearer.startsWith("Bearer ")) {
          return json({ code: "unauthorized", message: "missing bearer token", error: { message: "missing bearer token", code: "unauthorized", type: "free_pi_error" } }, 401)
        }
        if (bearer === "Bearer expired") {
          return json({ code: "unauthorized", message: "invalid or expired token" }, 401)
        }
        return json(ME)
      }

      if (path === "/v1/chat/completions") {
        if (!bearer) return json({ code: "unauthorized", message: "missing bearer token" }, 401)
        const encoder = new TextEncoder()
        const chunks = [
          { id: "c1", object: "chat.completion.chunk", model: "deepseek-ai/deepseek-v41-flash-1017", service_tier: "standard", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
          { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "pondering" }, finish_reason: null }] },
          { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "pong" }, finish_reason: null }] },
          { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          { id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, completion_tokens_details: { reasoning_tokens: 1 }, prompt_tokens_details: { cached_tokens: 0 } } },
        ]
        const bodyStream = new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`))
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
          },
        })
        return new Response(bodyStream, { headers: { "content-type": "text/event-stream" } })
      }

      return new Response("404 Not Found", { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    last(path) {
      return seen.filter((r) => r.path === path).at(-1)
    },
    close: () => server.stop(true),
  }
}

if (import.meta.main) {
  const mock = startMock({ port: Number(process.env.MOCK_PORT) || 0, free: !process.env.MOCK_NO_FREE })
  console.log(`mock FreePi at ${mock.url}`)
  console.log(`try: FREEPI_BASE_URL=${mock.url} …`)
}
