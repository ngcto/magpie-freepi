// FreePi's endpoints, as the requests its own client makes (§1, §2, §4).

import { CLI_FLOOR, CONSENT_VERSION, ENDPOINTS, HEADERS, baseUrl } from "./contract.mjs"

const JSON_POST = { "content-type": "application/json" }

// deviceReport is the timezone and locale the client sends with a poll (§1.1
// step 3). They are its own, never the server's idea of where the machine is.
export function deviceReport(env = globalThis.process?.env ?? {}, intl = Intl) {
  let timezone = ""
  let locale = ""
  try {
    timezone = env.TZ || intl.DateTimeFormat().resolvedOptions().timeZone || ""
    locale = new intl.DateTimeFormat().resolvedOptions().locale || ""
  } catch {}
  return { ...(timezone ? { timezone } : {}), ...(locale ? { locale } : {}) }
}

export function platformOf(nav = globalThis.navigator, proc = globalThis.process) {
  const os = proc?.platform === "darwin" ? "macos" : proc?.platform || ""
  return { ...(os ? { os } : {}), cli_version: CLI_FLOOR }
}

async function post(fetchImpl, base, path, body, headers = {}) {
  return fetchImpl(`${base}${path}`, {
    method: "POST",
    headers: { ...JSON_POST, ...headers },
    body: JSON.stringify(body),
  })
}

// startConnect begins the connect flow, which is the one FreePi's client
// prefers: the browser talks to freepi.ai and the client only polls, so the
// machine running magpie needs no reachable port.
export async function startConnect({ base = baseUrl(), fetchImpl = fetch } = {}) {
  const res = await post(fetchImpl, base, ENDPOINTS.connectStart, { consent_version: CONSENT_VERSION, client: platformOf() }, {
    [HEADERS.signInExp]: "1",
  })
  const body = await readJson(res)
  if (!res.ok) throw signInFailure(res, body, "FreePi wouldn't start a sign-in")
  if (!body?.session_id || !body?.poll_secret || !body?.connect_url) {
    throw Object.assign(new Error("FreePi's connect flow answered without a session to poll"), { code: "unexpected" })
  }
  return {
    flow: "connect",
    sessionId: body.session_id,
    pollSecret: body.poll_secret,
    confirmCode: body.confirm_code || "",
    connectUrl: body.connect_url,
    interval: Number(body.interval) > 0 ? Number(body.interval) : 2,
    expiresIn: Number(body.expires_in) > 0 ? Number(body.expires_in) : 600,
  }
}

export async function startDevice({ base = baseUrl(), fetchImpl = fetch } = {}) {
  const res = await post(fetchImpl, base, ENDPOINTS.device, {})
  const body = await readJson(res)
  if (!res.ok) throw signInFailure(res, body, "FreePi wouldn't start a sign-in")
  if (!body?.session_id || !body?.user_code || !body?.verification_uri) {
    throw Object.assign(new Error("FreePi's device flow answered without a code"), { code: "unexpected" })
  }
  return {
    flow: "device",
    sessionId: body.session_id,
    userCode: body.user_code,
    verifyUrl: body.verification_uri_complete || body.verification_uri,
    interval: Number(body.interval) > 0 ? Number(body.interval) : 5,
    expiresIn: Number(body.expires_in) > 0 ? Number(body.expires_in) : 900,
  }
}

// submitConsent records the consent the person was shown before the flow
// started. It gates token issuance for that session, so it is part of the
// sign-in rather than something done later.
export async function submitConsent(start, { base = baseUrl(), fetchImpl = fetch } = {}) {
  const res = await post(fetchImpl, base, ENDPOINTS.consent, {
    session_id: start.sessionId,
    consent_version: CONSENT_VERSION,
  })
  if (!res.ok) throw signInFailure(res, await readJson(res), "FreePi wouldn't record consent")
}

// pollForToken polls the flow's own endpoint until FreePi issues the token,
// honouring the interval it asked for and any slow-down it forwards (§1.1).
export async function pollForToken(start, { base = baseUrl(), fetchImpl = fetch, signal, now = Date.now, sleep = pause } = {}) {
  const path = start.flow === "connect" ? ENDPOINTS.connectPoll : ENDPOINTS.token
  const body =
    start.flow === "connect"
      ? { session_id: start.sessionId, poll_secret: start.pollSecret, ...deviceReport() }
      : { session_id: start.sessionId, ...deviceReport() }
  const deadline = now() + start.expiresIn * 1000
  let wait = start.interval
  let down = 0
  for (;;) {
    throwIfAborted(signal)
    let res
    try {
      res = await post(fetchImpl, base, path, body)
      down = 0
    } catch (err) {
      if (++down >= 6) throw err
      await sleep(start.interval * 1000, signal)
      continue
    }
    const answer = await readJson(res)
    if (res.ok) {
      if (typeof answer?.token === "string" && answer.token) return answer.token
      const retry = Number(answer?.retry_after)
      if (Number.isFinite(retry) && retry > wait) wait = retry
    } else {
      throw signInFailure(res, answer, "FreePi didn't finish the sign-in")
    }
    if (now() + wait * 1000 > deadline) {
      throw Object.assign(new Error("The sign-in code expired; start it again"), { code: "login_expired" })
    }
    await sleep(wait * 1000, signal)
  }
}

// me is the account surface the allowance, the tier and the lane come from.
export async function me(token, { base = baseUrl(), fetchImpl = fetch, headers = {}, signal } = {}) {
  const res = await fetchImpl(`${base}${ENDPOINTS.me}`, {
    headers: { ...headers, authorization: `Bearer ${token}` },
    signal,
  })
  return { res, body: await readJson(res) }
}

// catalog is public: it is the only model list FreePi has, and the version
// gate's `min` and `latest` come with it.
export async function catalog({ base = baseUrl(), fetchImpl = fetch, signal } = {}) {
  const res = await fetchImpl(`${base}${ENDPOINTS.catalog}`, { signal })
  if (!res.ok) throw new Error(`FreePi's catalog answered ${res.status}`)
  return res.json()
}

// signInFailure turns a refused sign-in step into an error that says what the
// person can do about it (§5). magpie shows its message as it is.
export function signInFailure(res, body, what) {
  const code = codeOf(body) || `http_${res.status}`
  const said = body?.message || body?.error?.message || ""
  const why = said ? `${what}: ${said}` : `${what} (${res.status})`
  const err = Object.assign(new Error(why), { code, status: res.status })
  if (code === "consent_required") {
    err.message = `${what}: FreePi needs your consent to be recorded first. Accept its terms at ${ERROR_HINT} and sign in again.`
    err.signIn = "expired"
  }
  if (code === "denied") err.message = "FreePi's sign-in was declined in the browser"
  if (code === "expired" || code === "expired_token") err.message = "FreePi's sign-in code expired; start it again"
  if (code === "region_unavailable") err.message = "FreePi is not available in the region this machine reports"
  return err
}

const ERROR_HINT = "https://freepi.ai/terms"

export function codeOf(body) {
  const top = typeof body?.code === "string" ? body.code : ""
  const nested = typeof body?.error?.code === "string" ? body.error.code : ""
  return top || nested
}

async function readJson(res) {
  const text = await res.text().catch(() => "")
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 300) }
  }
}

export function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted())
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(aborted())
    }
    signal?.addEventListener?.("abort", onAbort, { once: true })
  })
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw aborted()
}

function aborted() {
  return Object.assign(new Error("the sign-in was cancelled"), { name: "AbortError" })
}
