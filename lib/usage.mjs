// magpie's `auth.usage` windows from FreePi's own allowance (§4).
//
// The daily allowance is credits: `allowance_credits` is the day's total and
// `remaining_credits_today` what is left of it. `refill_at` is the server's own
// next reset (UTC midnight) and is passed on, never computed here. Smart
// routing ranks accounts by the biggest window they hold and when it renews,
// so this one window is what makes quota-first routing work per account.

const DAY = 86_400
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const share = (part, whole) => (whole > 0 && part !== null ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : null)
const count = (n) => n.toLocaleString("en-US")

export function usageFrom(body) {
  if (!body || typeof body !== "object") return { windows: [], error: "FreePi told no usage" }
  const left = num(body.remaining_credits_today)
  const total = num(body.allowance_credits)
  const resetsAt = typeof body.refill_at === "string" ? body.refill_at : ""
  const lane = typeof body.lane === "string" ? body.lane : ""
  const windows = []

  if (total !== null && left !== null && total > 0) {
    const used = Math.max(0, total - left)
    windows.push({
      name: "Today",
      used: share(used, total),
      amount: used,
      limit: total,
      unit: "credits",
      resetsAt,
      span: DAY,
      display: `${count(Math.max(0, left))} / ${count(total)} credits left${lane ? ` · ${lane} lane` : ""}`,
    })
  } else if (num(body.cap_usd_today) !== null && num(body.remaining_usd_today) !== null && body.cap_usd_today > 0) {
    const cap = body.cap_usd_today
    const rest = Math.max(0, body.remaining_usd_today)
    const used = Math.max(0, cap - rest)
    windows.push({
      name: "Today",
      used: share(used, cap),
      amount: used,
      limit: cap,
      unit: "USD",
      resetsAt,
      span: DAY,
      display: `$${rest.toFixed(2)} / $${cap.toFixed(2)} left${lane ? ` · ${lane} lane` : ""}`,
    })
  } else if (lane) {
    // The server told a lane and no share: magpie shows the words and leaves
    // routing to count the account as one it can't weigh, not as one with all
    // of its allowance left.
    windows.push({ name: "Today", display: `${lane} lane`, resetsAt, span: DAY })
  }

  // Purchased credit is a balance, not a share of the free allowance: it is
  // shown, and set aside so using it up does not stop the account.
  const credit = num(body.credit_usd)
  if (credit !== null && credit > 0) {
    windows.push({ name: "Purchased credit", balance: credit, unit: "USD", aside: true })
  }

  return {
    plan: planOf(body),
    ...(typeof body.handle === "string" && body.handle ? { user: body.handle } : {}),
    windows,
    ...(typeof body.notice === "string" && body.notice ? { balance: body.notice } : {}),
  }
}

function planOf(body) {
  const tier = typeof body.tier === "string" && body.tier ? body.tier : ""
  return tier ? `FreePi · ${tier}` : "FreePi"
}
