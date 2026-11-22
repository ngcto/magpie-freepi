# What magpie asks of a provider plugin

This is what `magpie-freepi` is built against, read from magpie's own source and
its plugin documentation (`usemagpie.ai/docs/plugins`) — not paraphrased from a
blog. Every claim below cites where it lives: `docs/plugins` is the published
page, `internal/plugin/host.js` and `internal/provider/*` are
[github.com/yetone/magpie](https://github.com/yetone/magpie).

## The package

magpie loads the plugin from `package.json`: `exports["./server"]`, then `main`,
then `exports["."]`, else `index.ts|js|mjs|cjs` at the root. It runs every plugin
in one Bun host process; Bun runs TypeScript as is, so no build step is possible
for a plugin installed from git — whatever the file is, it must be committed.

```json
{
  "name": "magpie-freepi",
  "type": "module",
  "main": "./index.mjs",
  "keywords": ["opencode", "opencode-plugin", "magpie", "magpie-plugin", "freepi"],
  "license": "MIT",
  "magpie": {
    "icon": "https://freepi.ai/icon.svg",
    "name": "FreePi",
    "summary": { "en": "…" },
    "maxConcurrency": 1
  }
}
```

| field | who reads it |
| --- | --- |
| `magpie.icon` | the plugin's card in Discover and its row in Installed, and the picture of each of its providers that gives none. An `https://` URL or a `data:image/…` URI, at most 1 MB. |
| `magpie.name` | its row's title, when the community list doesn't name it. |
| `magpie.summary` | its card's line, by language. |
| `magpie.maxConcurrency` | how many requests **each account** takes at once. A user's setting on the provider wins over it. |
| `keywords` | the npm search on Plugins asks for `<query> opencode` and shows a package whose name or keywords hold `opencode` **and** one of `auth`, `plugin`, `provider`. |

Listing: a GitHub repository tagged `magpie-plugin` shows under Plugins →
Discover → Unofficial, with `package.json` at the root. Its licence is what
GitHub reads from `LICENSE`. The maintained alternative is a
`registry.json` entry in `magpie-community/plugins`.

## The hooks

`export default async (input, options) => hooks`, where `hooks` is
`{config, auth, provider, "chat.headers"}`. magpie calls only `config`, `auth`
(its methods, `loader`, `usage`, `refresh`, `checkin`), `provider.models` and
`chat.headers`; OpenCode's other hooks are not called.

`input` carries `client.auth.set/.remove` (scoped to the account being handled),
`client.app.log`, `directory` (magpie's config folder), `$`, and magpie's own
`input.magpie.options` / `.load`.

### `config` — declaring the provider

```js
config: async (cfg) => {
  cfg.provider ??= {}
  cfg.provider.freepi ??= {
    name: "FreePi",
    npm: "@ai-sdk/openai-compatible",   // the API its models speak
    api: "https://api.freepi.ai/v1",
    models: { "deepseek-v4-flash": { name: "…", limit: { context: 200000, output: 32768 }, tool_call: true } },
  }
}
```

Use `??=` so a provider the user configured by hand is not written over. The
`npm` package decides which API the agent's request is **translated into** before
it reaches `fetch`: `@ai-sdk/anthropic` → `/messages`;
`@ai-sdk/openai` → `/responses`; `@ai-sdk/google` →
`/models/<id>:streamGenerateContent`; anything else → `/chat/completions`. A
model may name its own `provider: {npm, api}`. The base is the loader's
`baseURL`, else the model's `api`, else the provider's `api`, else the SDK's
default.

Model fields magpie reads beside OpenCode's (`limit`, `capabilities`, `cost`,
`variants`): `free: true` (the plan serves it at no cost to the allowance — set
only from the vendor's own word), `rate` (the allowance multiple a request
costs), `rateWas`, `serviceTiers`, `also` (other APIs the vendor serves it on),
`decides`, `searches`, `temperature`.

### `auth` — signing an account in

`{ provider, methods, loader, usage?, refresh?, refreshLead?, checkin?, icon?, maxConcurrency? }`.
**`auth.provider` is the provider id**, and agents name its models
`<id>/<model>` — so `freepi/deepseek-v4-flash`.

Method shapes (`internal/plugin/host.js`, `methods()`):

```js
{ type: "api", label, placeholder }                       // a key field
{ type: "api", label, prompts: [...], async authorize(inputs) }
{ type: "oauth", label, prompts?, async authorize(inputs, { signal }) }
```

`prompts` are asked, in order, before `authorize`, each when its `when`/`condition`
holds; types are `text`, `password` (magpie's own, masked) and `select`.

An OAuth `authorize` returns `{url, instructions, method, callback}`:

- `method: "auto"` — magpie calls `callback(undefined, {signal})` at once and
  waits for it. This is the browser flow: the plugin starts something, and its
  own callback resolves when the vendor issues a token.
- `method: "code"` — magpie shows a paste field and only then calls
  `callback(code)`.

A success is `{type: "success", refresh, access, expires, ...extra}`; **every
extra field is kept beside them**, which is where a per-account identity lives.
A failure is `{type: "failed", error}` and magpie shows `error` (≤500 chars).
`provider: "other-id"` saves the sign-in to another provider.

#### "OAuth with a paste-a-callback-URL fallback"

magpie has exactly two paste affordances, and both are gated on the plugin's
shape (`internal/provider/pluginsignin.go`):

| what the person can paste | when magpie offers it |
| --- | --- |
| **a code** (`s.st.PasteCode`) | the method returned `method: "code"`: magpie prints the URL, then a `Code:` field, then calls `callback(code)`. |
| **the whole address the browser ended on** (`s.st.PasteCallback`) | the method returned `method: "auto"` **and the URL it gave names a loopback port** (`PluginPastesCallback` → `loopbackPorts(a.URL)`). magpie replays that address against `127.0.0.1:<that port>`, where the plugin is listening, and the sign-in finishes as if the browser had reached the machine. |

So a plugin that runs its own loopback listener and puts
`redirect_uri=http://127.0.0.1:PORT/…` in its authorize URL gets the paste
fallback for free, with no second method. FreePi has neither of those shapes:
its connect flow calls back **to freepi.ai**, so nothing has to reach the machine
and there is no address to paste. This plugin therefore uses `method: "auto"`
with its manual path as the sign-in's own question — paste a token from an
install that is already signed in — which is the same escape hatch for the same
failure (no browser that can reach the work). See the README's "Signing in".

### `loader` — what every request is made with

`loader(getAuth, provider)` runs once per account and again after its sign-in
changes. It returns:

| field | effect |
| --- | --- |
| `baseURL` | where requests go, ahead of the model's and provider's `api` |
| `apiKey` | sent as the SDK package sends it (`Authorization: Bearer` for anything but Anthropic/Google) |
| `headers` | added to every request |
| `fetch` | makes the request; without it, the host's plain `fetch` |

`fetch(input, init)`: `input` is the full URL (base + the path for the model's
API), `init.body` is the JSON in that API's shape, `init.headers` already holds
the key header, the loader's headers, the gateway's headers and `chat.headers`'
additions, and `init.signal` aborts when the agent gives up. **Return a
`Response`**; its status, headers and body go back as they came, streamed chunk
by chunk. A rewrite of a streamed body must drop `content-length` and
`content-encoding`.

### `auth.usage` — the allowance, and what Smart does with it

magpie's own hook (OpenCode ignores it). It runs in the account's scope, so a
token it renews is saved to that account. Everything is optional:

```js
{
  plan: "FreePi · young",
  user: "ada",
  until, renew: "auto" | "off", balance, error, signIn: "kept" | "expired" | "renewed",
  windows: [{
    name: "Today",
    used: 37,                 // percent; null/absent means "not told", never 0
    resetsAt: "2026-11-23T00:00:00.000Z",   // or resetSecs
    span: 86400,              // seconds the window runs
    amount: 5550, limit: 15000, unit: "credits",   // used is derived from these when absent
    display: "9,450 / 15,000 credits left",
    model, models, notModels, family, pool,
    aside: false,             // true: using it up does not stop the account, and routing ignores it
    runsOutAt, runsOut, credits, balance,
  }],
  resets: {count, until, byWindow, fiveHour, weekly, each},
}
```

What routing does with it (`internal/routes/strategies.go`, `Smart`):

- Seats are split into *fine* (<90% of a window, or not known), *low* (≥90% of a
  rate-capped window) and *spent* (100%, or out of quota). Fine seats come first.
- Among fine seats: the one whose **biggest window renews soonest** goes first
  (the week over the five hours in it; a five-hour window only among accounts
  with no week), because what it has left is lost at that reset. Renewing in the
  same hour → the one whose credits lapse first → then a wallet with more left.
- **An account whose windows all say no share is "not known"**, the same as one
  never read: it is *not* treated as one with everything left. So a plugin that
  reports `display` alone contributes nothing to quota-first ordering — which is
  why FreePi's usage sends `used` + `amount`/`limit` + `resetsAt` + `span`.
- A `balance`-only window (a prepaid wallet) doesn't invent a `used`; an empty
  wallet counts as used up. A window with `aside: true` is shown and never routed
  on.

magpie reads usage on its own cadence, not per request: the Providers card, the
tray, `magpie quota`, `GET /v1/magpie/quotas` and the router all read what
magpie last fetched. Nothing is pushed.

### `auth.refresh` and an expired sign-in

With `auth.refresh(auth, provider)` defined, magpie renews an OAuth account whose
`expires` is nearer than `refreshLead` (5 minutes by default) — once at a time,
before the account's loader, `provider.models`, `usage` or a request. What it
returns is merged over the account; an error with `signIn: "expired"` marks the
account as needing a new sign-in and stops sending to it until it is signed in
again.

Without a refresh token there is nothing to renew, and a hook that pretends
otherwise would keep a dead token in rotation. This plugin sets `expires` from
the token's own `exp` claim and lets `refresh` report that the sign-in ended.

### `provider.models` — what this account may use

`models(provider, {auth})`, called once per account in that account's scope
through its proxy. Return the full list — **each account serves only the models
listed for it**. Return `provider.models` unchanged (or throw) on a failed fetch
and magpie keeps the list it had; `list[Symbol.for("magpie.fellBack")] = true`
does the same for a list of your own. A model with `status: "deprecated"` is
hidden. Throw with `signIn: "expired"` when what failed was the sign-in.

### `auth.checkin` and `chat.headers`

`checkin(getAuth, provider)` presses a vendor's daily check-in and answers
`{outcome: claimed|done|ineligible|inactive|captcha|failed, credit, streak, message}`.
FreePi has no check-in, so none is defined.
`chat.headers(input, output)` runs per request, with `input.sessionID` (magpie's
conversation id, stable across a turn's turns), `input.caller` and
`input.model.providerID`.

## Requests, errors and failover

- Any agent API arrives: the gateway translates to the model's API and hands the
  result to `fetch`; a client request on an API the model also lists (`also`) is
  relayed as it was sent.
- A non-2xx response is the vendor's answer: a rate limit or a server error moves
  the request to the next account or model; a `401` marks the account. Answer a
  model the account may not use with `403`/`404`, not `401`, or magpie reads it as
  a dead sign-in.
- `X-Magpie-Sign-In: expired | kept | renewed` on the response tells magpie
  exactly what an answer meant; magpie removes the header before the answer
  goes on.
- magpie strips `x-magpie-*` headers on their way out and tells the plugin
  `x-magpie-work-dir`, `x-magpie-work-git`, `x-magpie-session`,
  `x-magpie-subagent`, `x-magpie-caller-agent|name|via` on the way in.

## Testing it yourself

```bash
sb=$(mktemp -d)
m() { env HOME=$sb XDG_CONFIG_HOME=$sb/.config XDG_CACHE_HOME=$sb/.cache MAGPIE_ADDR=127.0.0.1:3499 magpie "$@"; }
m plugin add ./magpie-freepi
m plugin --json
m plugin login freepi
m provider test freepi
m quota
```

Each `magpie` command starts its own host, so a folder plugin is always loaded
as it is now. A plugin that fails to load says why in `magpie plugin`.
