import { OpenAPIHono } from "@hono/zod-openapi"

import { tokenManager } from "~/lib/token-manager"
import { getCopilotUsage, getCopilotUsageForAllTokens } from "~/services/github/get-copilot-usage"

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

  // GET /usage
  app.get("/usage", async (c) => {
    try {
      // Check for grouped query parameter
      const grouped = c.req.query("grouped") === "true"

      if (grouped) {
        // Return usage grouped by token
        const tokenUsage = await getCopilotUsageForAllTokens()
        return c.json({
          grouped: true,
          tokens: tokenUsage.map((tu) => ({
            token_id: tu.tokenId,
            username: tu.username,
            account_type: tu.accountType,
            error: tu.error,
            usage: tu.usage,
          })),
        })
      }

      // Get usage from first active token
      const usage = await getCopilotUsage()
      return c.json(usage)
    } catch (error) {
      console.error("Error fetching Copilot usage:", error)
      return c.json({ error: { message: "Failed to fetch Copilot usage", type: "error" } }, 500)
    }
  })

  // GET /quota - Grouped quota display for all tokens
  app.get("/quota", async (c) => {
    try {
      const tokenUsage = await getCopilotUsageForAllTokens()
      
      return c.json({
        tokens: tokenUsage.map((tu) => ({
          token_id: tu.tokenId,
          username: tu.username,
          account_type: tu.accountType,
          error: tu.error,
          quota: tu.usage ? {
            chat: tu.usage.quota_snapshots?.chat,
            completions: tu.usage.quota_snapshots?.completions,
            premium_interactions: tu.usage.quota_snapshots?.premium_interactions,
            reset_date: tu.usage.quota_reset_date,
            copilot_plan: tu.usage.copilot_plan,
          } : null,
        })),
      })
    } catch (error) {
      console.error("Error fetching quota:", error)
      return c.json({ error: { message: "Failed to fetch quota", type: "error" } }, 500)
    }
  })
}
