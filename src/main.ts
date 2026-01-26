import "dotenv/config"

import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import consola from "consola"
import { join } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"

import { initializeDatabase } from "~/lib/database"
import { tokenManager } from "~/lib/token-manager"
import { apiKeyAuth, isApiKeyEnabled } from "~/lib/auth-middleware"
import { registerOpenAIRoutes } from "~/routes/openai/routes"
import { registerAnthropicRoutes } from "~/routes/anthropic/routes"
import { registerGeminiRoutes } from "~/routes/gemini/routes"
import { registerUtilityRoutes } from "~/routes/utility/routes"
import { registerAuthRoutes } from "~/routes/auth/routes"

const PORT = parseInt(process.env.PORT || "4242", 10)
const TOKEN_REFRESH_INTERVAL = 25 * 60 * 1000 // 25 minutes
const ENVIRONMENT = process.env.ENVIRONMENT || "Development"
const isProduction = ENVIRONMENT === "Production"

// Get the package root directory (for static files)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// When running via npx, COPILOT_ROUTER_ROOT is set by CLI; otherwise use relative path
const PACKAGE_ROOT = process.env.COPILOT_ROUTER_ROOT || join(__dirname, "..")
const PUBLIC_DIR = join(PACKAGE_ROOT, "public")

async function main() {
  consola.info(`Starting Copilot Router in ${ENVIRONMENT} mode...`)

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
    consola.warn("No tokens found. Use /auth/login to add tokens or run 'gh auth login'.")
  }

  // Create OpenAPI Hono app
  const app = new OpenAPIHono()

  // Middleware
  app.use(logger())
  app.use(cors())

  // API Key authentication for protected routes
  // Applies to all API routes: /chat/*, /v1/*, /v1beta/*
  // Does NOT apply to: /, /login, /static/*, /auth/*, /openapi.json
  const authMiddleware = apiKeyAuth()
  app.use("/chat/*", authMiddleware)
  app.use("/v1/*", authMiddleware)
  app.use("/v1beta/*", authMiddleware)
  app.use("/embeddings", authMiddleware)

  // Register utility routes at root (no auth required for /)
  registerUtilityRoutes(app)

  // Handler for blocked endpoints in Production mode
  const productionBlockedHandler = (c: any) => {
    return c.json({ error: { message: "This endpoint is disabled in Production mode", type: "forbidden" } }, 403)
  }

  // Register auth routes (no auth required for login flow)
  // In Production mode, /auth/* endpoints are blocked
  if (!isProduction) {
    registerAuthRoutes(app)
  } else {
    app.all("/auth/*", productionBlockedHandler)
  }

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
  app.use("/static/*", serveStatic({ root: PUBLIC_DIR, rewriteRequestPath: (path) => path.replace("/static", "") }))

  // /login page - disabled in Production mode
  if (!isProduction) {
    app.get("/login", serveStatic({ path: join(PUBLIC_DIR, "index.html") }))
  } else {
    app.get("/login", productionBlockedHandler)
  }

  // OpenAPI documentation - disabled in Production mode
  if (!isProduction) {
    app.doc("/openapi.json", {
      openapi: "3.0.0",
      info: {
        title: "Copilot Router API",
        version: "1.0.0",
        description: "GitHub Copilot API with OpenAI, Anthropic, and Gemini compatibility",
      },
    })
  } else {
    app.get("/openapi.json", productionBlockedHandler)
  }

  // Start server
  consola.info(`Starting server on port ${PORT}...`)
  serve({
    fetch: app.fetch,
    port: PORT,
  })

  consola.success(`Copilot Router running at http://localhost:${PORT}`)

  consola.info("Available endpoints:")
  if (!isProduction) {
    consola.info("  Web UI:    GET /login")
    consola.info("  Auth:      POST /auth/login, POST /auth/complete, GET /auth/tokens")
  }
  consola.info("  OpenAI:    POST /v1/chat/completions, GET /v1/models, POST /v1/embeddings")
  consola.info("  Anthropic: POST /v1/messages, POST /v1/messages/count_tokens")
  consola.info("  Gemini:    POST /v1beta/models/:model:generateContent")
  consola.info("  Utility:   GET /")
  if (!isProduction) {
    consola.info("  Docs:      GET /openapi.json")
  } else {
    consola.info("  (Production mode: /login, /auth/*, /openapi.json are disabled)")
  }
}

main().catch((error) => {
  consola.error("Failed to start server:", error)
  process.exit(1)
})
