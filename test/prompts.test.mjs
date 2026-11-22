// The sign-in's questions, walked the way magpie's host walks them.
//
// The oracle below is copied verbatim from internal/plugin/host.js (magpie's
// `applies()`, in the "signing in" section), because the rule it holds is not
// obvious and getting it wrong asked every person for a token they didn't have:
// a `when` that names no op is NEGATED there, so `{key, value}` alone means
// "unless the answer is value".
import { test, expect } from "bun:test"
import { authHook } from "../lib/auth.mjs"

function applies(prompt, inputs) {
  if (prompt.when) {
    const v = inputs[prompt.when.key]
    if (v === undefined) return false
    const eq = v === prompt.when.value
    if (prompt.when.op === "eq" ? !eq : eq) return false
  }
  if (typeof prompt.condition === "function" && !prompt.condition(inputs)) return false
  return true
}

// nextPrompt is magpie's: the method's next question for the answers so far,
// in order, skipping the ones already answered and the ones whose `when` fails.
function nextPrompt(method, inputs) {
  for (const p of method.prompts ?? []) {
    if (p.key in inputs) continue
    if (!applies(p, inputs)) continue
    return p
  }
  return null
}

// asked answers every question magpie would ask for a method, in order, from
// the answers a person gives at each step.
function asked(method, answers) {
  const inputs = {}
  const seen = []
  for (let q = nextPrompt(method, inputs); q && q.key in answers; q = nextPrompt(method, inputs)) {
    inputs[q.key] = answers[q.key]
    seen.push(q.key)
  }
  return { keys: seen, inputs, waitingOn: nextPrompt(method, inputs)?.key ?? null }
}

const method = authHook({ base: "http://127.0.0.1:1" }).methods[0]

test("the browser answer asks nothing more", () => {
  expect(asked(method, { terms: "browser" })).toEqual({
    keys: ["terms"],
    inputs: { terms: "browser" },
    waitingOn: null,
  })
})

test("cancelling asks nothing more", () => {
  expect(asked(method, { terms: "cancel" }).keys).toEqual(["terms"])
})

test("pasting a token asks exactly the token question", () => {
  const walk = asked(method, { terms: "token", token: "paste-me" })
  expect(walk.keys).toEqual(["terms", "token"])
  expect(walk.waitingOn).toBeNull()
})

test("the token question is a password field, and gated with an explicit op", () => {
  const token = method.prompts.find((p) => p.key === "token")
  expect(token.type).toBe("password")
  expect(token.when).toEqual({ key: "terms", op: "eq", value: "token" })
})

test("no other question leans on the inverted default", () => {
  for (const p of method.prompts) {
    if (p.when) expect(p.when.op).toBe("eq")
    expect(p.condition).toBeUndefined()
  }
})
