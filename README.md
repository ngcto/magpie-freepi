# magpie-freepi

FreePi ([freepi.ai](https://freepi.ai)) as a provider in [magpie](https://usemagpie.ai): its free
daily allowance, its model catalog, and its streaming inference, on every agent magpie serves.

```
freepi/deepseek-v4-flash
freepi/gpt-6.2-astra
freepi/gemini-4-neon
```

## What it does

- **Signs in the way FreePi does.** GitHub, through FreePi's own connect page. The plugin polls the
  server, so the machine running magpie needs no reachable port and the browser can be anywhere.
  The GitHub device flow is the fallback when a server has no connect flow.
- **Keeps FreePi's daily allowance visible and routable.** `magpie quota` shows the day's credits,
  when they refill, and the lane the server put the account in — and magpie's Smart routing ranks
  accounts by it, so a fresh account is tried before a spent one.
- **Lists the models FreePi lists**, with each model's allowance multiplier (`usage_x`), so it is
  visible that `gpt-6.2-astra` costs about 51× what the default model does.
- **Streams FreePi's replies unchanged**: text in `delta.content`, thinking in
  `delta.reasoning_content`, the usage chunk at the end, tool calls, `[DONE]`.

## Install

```bash
magpie plugin add ngcto/magpie-freepi      # from GitHub
magpie plugin add ./magpie-freepi          # or from a folder, loaded where it is
magpie plugin login freepi
magpie provider test freepi
magpie quota
```

Then pick `freepi/<model>` in any agent magpie is set up for.

## Signing in

There is one sign-in, and it starts with FreePi's terms, because FreePi is free for a reason:
**sessions are stored as traces and used to train models, and ad cards see excerpts of the
conversation.** Accept them there, or don't sign in.

It then opens FreePi's connect page. Approve it, confirm the code it shows if it asks, and this
window finishes on its own. Nothing has to be forwarded to this machine.

If the browser is somewhere this machine can't follow, the same sign-in asks one question first:
**paste a token instead**. A FreePi token is a single string in `~/.free-pi/agent/credentials.json`
on a machine that has already signed in. (FreePi has no callback URL to paste: its connect flow ends
at freepi.ai, never at the machine, so there is no local port to replay. The pasted token is the
honest equivalent, and it is the same token that machine holds — one account, one token.)

Sign-ins are kept in magpie's `plugin-auth.json` beside every other plugin's. The token is a
90-day credential with no refresh token and no refresh endpoint: when it ends, magpie marks the
account and you sign in again.

## Limits, and what they mean for routing

| | |
| --- | --- |
| allowance | the day's free credits, reset at `refill_at` (UTC midnight, server-owned) |
| past the allowance | FreePi's own `lane`: `fallback` (slow) or `wait` (rejected with a clock) |
| concurrency | one live request per account, so `magpie.maxConcurrency` is 1. A second one gets FreePi's 429 `concurrent`; a second *session* on one token gets a 409, which the plugin passes on rather than retrying |
| version gate | FreePi refuses any client under its own minimum (`426 upgrade_required`). The plugin reports the `latest` from FreePi's public catalog, never a made-up version |

## Terms of the service

The plugin makes the same requests FreePi's own client makes, and adds nothing: no ad context, no
ad endpoints, no telemetry, no second session per account, no parallel fan-out to multiply a daily
allowance. One token per magpie account, obtained by that account's owner signing in.

## Develop

```bash
bun test                     # the whole suite, against a mock FreePi in test/
bun test/mock-freepi.mjs     # just the mock, to poke by hand
node scripts/verify-live.mjs # against the real API, with a token you already have
```

`docs/magpie-plugin-contract.md` is the magpie side written down: what `package.json` fields matter,
the exact auth and usage shapes, what Smart routing does with a usage window, and how a plugin
becomes a provider that agents can name.

No secrets are in this repository, and none should be added.
