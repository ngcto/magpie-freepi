// FreePi's client↔server protocol, in one place.
//
// Every value cites its evidence in the crew spec
// (handoffs/MAFR-2/freepi-spec.md): "source" is FreePi's own client
// (free-pi-cli 0.6.25, MIT) and "live" is a capture against api.freepi.ai on
// 2026-11-22. Nothing here is inferred.

export const PROVIDER_ID = "freepi"
export const PROVIDER_NAME = "FreePi"

// src/pi-launch.ts: the backend, overridable with FREEPI_BASE_URL.
export const DEFAULT_BASE_URL = "https://api.freepi.ai"

export function baseUrl(env = globalThis.process?.env ?? {}) {
  const raw = env.FREEPI_BASE_URL
  return (typeof raw === "string" && raw ? raw : DEFAULT_BASE_URL).replace(/\/+$/, "")
}

// The version the plugin says it is. The completions route refuses anything
// under the catalog's `min` with 426 upgrade_required, and reports a version
// the client does not have is what that gate exists to detect. The catalog's
// `latest` replaces it at sign-in; this is the floor before a catalog answers.
export const CLI_FLOOR = "0.6.25"

// src/consent.ts: recorded when a sign-in starts, and a hard server gate.
export const CONSENT_VERSION = "4"

export const ENDPOINTS = {
  connectStart: "/auth/connect/start",
  connectPoll: "/auth/connect/poll",
  device: "/auth/github/device",
  consent: "/auth/consent",
  token: "/auth/token",
  me: "/me",
  catalog: "/client-version",
}

// §3.1: what a completion carries. `x-turn-id` is fresh per request;
// `x-session-id` is one per account and held for its life, because the
// server leases one live session per token (409 concurrent_session).
export const HEADERS = {
  session: "x-session-id",
  turn: "x-turn-id",
  version: "x-client-version",
  signInExp: "x-freepi-signin-exp",
}

// §2.1: the limits FreePi's client declares for every catalog model.
export const MODEL_LIMITS = { context: 200000, output: 32768 }

// src/consent.ts: what signing in to FreePi means for the person's sessions.
// It is said once, in plain words, in the sign-in itself.
export const CONSENT_SUMMARY =
  "FreePi is free because ads pay for it. Your sessions are saved as traces and used to train " +
  "models, with no opt-out, and ad cards see excerpts of the conversation."

export const TERMS_URL = "https://freepi.ai/terms"
