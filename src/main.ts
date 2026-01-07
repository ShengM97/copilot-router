import { serve } from "@hono/node-server"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import consola from "consola"

import { initializeState, refreshCopilotToken } from "~/lib/utils"
import { registerOpenAIRoutes } from "~/routes/openai/routes"
import { registerAnthropicRoutes } from "~/routes/anthropic/routes"
import { registerGeminiRoutes } from "~/routes/gemini/routes"
import { registerUtilityRoutes } from "~/routes/utility/routes"

const PORT = parseInt(process.env.PORT || "4242", 10)
const TOKEN_REFRESH_INTERVAL = 25 * 60 * 1000 // 25 minutes

async function main() {
  consola.info("Starting Copilot Router...")

  // Initialize state (read GitHub token, fetch Copilot token, cache models)
  await initializeState()

  // Create OpenAPI Hono app
  const app = new OpenAPIHono()

  // Middleware
  app.use(logger())
  app.use(cors())

  // Register utility routes at root
  registerUtilityRoutes(app)

  // OpenAI-compatible routes
  const openaiRouter = new OpenAPIHono()
  registerOpenAIRoutes(openaiRouter)
  app.route("/", openaiRouter)           // /chat/completions, /models, /embeddings
  app.route("/v1", openaiRouter)          // /v1/chat/completions, /v1/models, /v1/embeddings

  // Anthropic-compatible routes
  const anthropicRouter = new OpenAPIHono()
  registerAnthropicRoutes(anthropicRouter)
  app.route("/v1", anthropicRouter)       // /v1/messages, /v1/messages/count_tokens

  // Gemini-compatible routes
  const geminiRouter = new OpenAPIHono()
  registerGeminiRoutes(geminiRouter)
  app.route("/v1beta", geminiRouter)      // /v1beta/models/:model:generateContent

  // OpenAPI documentation
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Copilot Router API",
      version: "1.0.0",
      description: "GitHub Copilot API with OpenAI, Anthropic, and Gemini compatibility",
    },
  })

  // Start token refresh interval
  setInterval(refreshCopilotToken, TOKEN_REFRESH_INTERVAL)

  // Start server
  consola.info(`Starting server on port ${PORT}...`)
  serve({
    fetch: app.fetch,
    port: PORT,
  })

  consola.success(`Copilot Router running at http://localhost:${PORT}`)
  consola.info("Available endpoints:")
  consola.info("  OpenAI:    POST /v1/chat/completions, GET /v1/models, POST /v1/embeddings")
  consola.info("  Anthropic: POST /v1/messages, POST /v1/messages/count_tokens")
  consola.info("  Gemini:    POST /v1beta/models/:model:generateContent")
  consola.info("  Utility:   GET /, GET /token, GET /usage")
  consola.info("  Docs:      GET /openapi.json")
}

main().catch((error) => {
  consola.error("Failed to start server:", error)
  process.exit(1)
})
