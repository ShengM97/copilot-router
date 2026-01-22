import { OpenAPIHono } from "@hono/zod-openapi"

import { tokenManager } from "~/lib/token-manager"

export function registerUtilityRoutes(app: OpenAPIHono) {
  // GET /
  app.get("/", (c) => {
    const counts = tokenManager.getTokenCount()
    return c.text(`Copilot Router is running (${counts.active}/${counts.total} active tokens)`)
  })

  // GET /token
  app.get("/token", (c) => {
    try {
      const entries = tokenManager.getActiveTokenEntries()
      const tokens = entries.map(e => ({
        id: e.id,
        username: e.username,
        copilot_token: e.copilotToken?.substring(0, 20) + "...",
        expires_at: e.copilotTokenExpiresAt?.toISOString(),
      }))

      return c.json({
        count: tokens.length,
        tokens,
      })
    } catch (error) {
      console.error("Error fetching token:", error)
      return c.json({ error: { message: "Failed to fetch token", type: "error" } }, 500)
    }
  })
}
