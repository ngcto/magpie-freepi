// magpie provider plugin: FreePi — scaffold.
//
// The provider is declared here so magpie can load this repository and list it.
// The sign-in, its requests and its allowance are the work of the pull request
// that follows; until it lands, signing in says so rather than half-working.

const PROVIDER = "freepi"
const BASE = "https://api.freepi.ai/v1"

export default async function FreePiPlugin() {
  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] ??= {
        name: "FreePi",
        npm: "@ai-sdk/openai-compatible",
        api: BASE,
        models: {
          "deepseek-v4-flash": { name: "DeepSeek V4 Flash", limit: { context: 200000, output: 32768 }, tool_call: true },
        },
      }
    },
    auth: {
      provider: PROVIDER,
      methods: [
        {
          type: "oauth",
          label: "Sign in with FreePi",
          async authorize() {
            return { type: "failed", error: "FreePi's sign-in isn't in this scaffold yet" }
          },
        },
      ],
      async loader() {
        return {}
      },
      async usage() {
        return { windows: [], error: "FreePi isn't signed in" }
      },
    },
    provider: {
      id: PROVIDER,
      async models(provider) {
        return provider.models
      },
    },
  }
}
