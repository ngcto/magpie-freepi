// magpie provider plugin: FreePi (freepi.ai).
//
// magpie loads this file into its Bun host and calls the one function it
// exports. The hooks it returns are magpie's own contract
// (usemagpie.ai/docs/plugins): `config` declares the provider, `auth` signs an
// account in and makes its requests, and `provider.models` lists what that
// account may use.

import { PROVIDER_ID, baseUrl } from "./lib/contract.mjs"
import { providerConfig, modelsHook } from "./lib/provider.mjs"
import { authHook } from "./lib/auth.mjs"

// defenseOn is the plugin's one switch, as magpie keeps it: a key the auth
// hook declares, which the plugin's editor shows and
// `magpie plugin options freepi '{"defense": true}'` sets.
function defenseOn(magpie) {
  if (typeof magpie?.option === "function") return magpie.option(PROVIDER_ID, "defense") === true
  const opts = typeof magpie?.options === "function" ? magpie.options(PROVIDER_ID) : magpie?.options
  return opts?.defense === true
}

export default async function FreePiPlugin(input = {}) {
  const base = baseUrl()
  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER_ID] ??= providerConfig()
    },
    auth: authHook({ client: input.client, base }),
    provider: {
      id: PROVIDER_ID,
      models: modelsHook({ defense: () => defenseOn(input.magpie) }),
    },
  }
}

// What a test can reach without a plugin host. Nothing here is exported as a
// bare function, because magpie calls every exported function as a plugin.
export const _internal = {
  providerConfig,
  modelsHook,
  authHook,
  defenseOn,
}
