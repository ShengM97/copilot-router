import "dotenv/config"

import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import consola from "consola"

import { initializeDatabase } from "~/lib/database"
import { tokenManager } from "~/lib/token-manager"
import { registerOpenAIRoutes } from "~/routes/openai/routes"
import { registerAnthropicRoutes } from "~/routes/anthropic/routes"
import { registerGeminiRoutes } from "~/routes/gemini/routes"
import { registerUtilityRoutes } from "~/routes/utility/routes"
import { registerAuthRoutes } from "~/routes/auth/routes"

const PORT = parseInt(process.env.PORT || "4242", 10)
const TOKEN_REFRESH_INTERVAL = 25 * 60 * 1000 // 25 minutes

async function main() {
  consola.info("Starting Copilot Router...")

  // Initialize database
  consola.info("Connecting to SQL Server...")
  await initializeDatabase()

  // Load tokens from database
  consola.info("Loading tokens from database...")
  await tokenManager.loadFromDatabase()

  // Refresh all Copilot tokens
  const tokenCount = tokenManager.getTokenCount()
  if (tokenCount.total > 0) {
    consola.info(`Found ${tokenCount.total} tokens, refreshing Copilot tokens...`)
    const updatedCount = tokenManager.getTokenCount()
    consola.success(`${updatedCount.active} tokens active`)
  } else {
    consola.warn("No tokens found in database. Use /auth/login to add tokens.")
  }

  // Create OpenAPI Hono app
  const app = new OpenAPIHono()

  // Middleware
  app.use(logger())
  app.use(cors())

  // Register utility routes at root
  registerUtilityRoutes(app)

  // Register auth routes
  registerAuthRoutes(app)

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

  // Serve static files (login page)
  app.use("/static/*", serveStatic({ root: "./public", rewriteRequestPath: (path) => path.replace("/static", "") }))
  app.get("/login", serveStatic({ path: "./public/index.html" }))

  // OpenAPI documentation
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Copilot Router API",
      version: "1.0.0",
      description: "GitHub Copilot API with OpenAI, Anthropic, and Gemini compatibility",
    },
  })

  // Start server
  consola.info(`Starting server on port ${PORT}...`)
  serve({
    fetch: app.fetch,
    port: PORT,
  })

  consola.success(`Copilot Router running at http://localhost:${PORT}`)
  consola.info("Available endpoints:")
  consola.info("  Web UI:    GET /login")
  consola.info("  Auth:      POST /auth/login, POST /auth/complete, GET /auth/tokens")
  consola.info("  OpenAI:    POST /v1/chat/completions, GET /v1/models, POST /v1/embeddings")
  consola.info("  Anthropic: POST /v1/messages, POST /v1/messages/count_tokens")
  consola.info("  Gemini:    POST /v1beta/models/:model:generateContent")
  consola.info("  Utility:   GET /, GET /token, GET /usage, GET /quota")
  consola.info("  Docs:      GET /openapi.json")
}

main().catch((error) => {
  consola.error("Failed to start server:", error)
  process.exit(1)
})
