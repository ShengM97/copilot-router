import { OpenAPIHono } from "@hono/zod-openapi"
import consola from "consola"

import { tokenManager } from "~/lib/token-manager"
import { getDeviceCode } from "~/services/github/get-device-code"
import { checkAccessToken } from "~/services/github/poll-access-token"

// Track device codes being processed to prevent duplicate token additions
const processingDeviceCodes = new Set<string>()

export function registerAuthRoutes(app: OpenAPIHono) {
  // POST /auth/login - Start device code flow
  app.post("/auth/login", async (c) => {
    try {
      const deviceCode = await getDeviceCode()
      
      consola.info(`Login initiated. Please visit ${deviceCode.verification_uri} and enter code: ${deviceCode.user_code}`)
      
      return c.json({
        user_code: deviceCode.user_code,
        verification_uri: deviceCode.verification_uri,
        device_code: deviceCode.device_code,
        expires_in: deviceCode.expires_in,
        interval: deviceCode.interval,
      })
    } catch (error) {
      consola.error("Failed to start login:", error)
      return c.json(
        { error: { message: "Failed to start login", type: "auth_error" } },
        500
      )
    }
  })

  // POST /auth/complete - Check device code flow status (single check, client polls)
  app.post("/auth/complete", async (c) => {
    try {
      const body = await c.req.json()
      const { device_code, account_type = "individual" } = body

      if (!device_code) {
        return c.json(
          { error: { message: "device_code is required", type: "validation_error" } },
          400
        )
      }

      // Check access token once
      const result = await checkAccessToken(device_code)

      if (result.error === "authorization_pending") {
        // User hasn't authorized yet, client should continue polling
        return c.json({ status: "pending", message: "Waiting for user authorization" })
      }

      if (result.error === "slow_down") {
        // Rate limited, client should slow down
        return c.json({ status: "slow_down", message: "Please slow down polling" })
      }

      if (result.error === "expired_token") {
        return c.json(
          { error: { message: "Device code expired. Please try again.", type: "expired" } },
          400
        )
      }

      if (result.error === "access_denied") {
        return c.json(
          { error: { message: "Access denied by user.", type: "denied" } },
          400
        )
      }

      if (result.error) {
        return c.json(
          { error: { message: result.error_description || result.error, type: "auth_error" } },
          400
        )
      }

      if (!result.access_token) {
        return c.json({ status: "pending", message: "Waiting for user authorization" })
      }

      // Check if this device code is already being processed
      if (processingDeviceCodes.has(device_code)) {
        return c.json({ status: "processing", message: "Token is being added, please wait" })
      }

      // Mark as processing
      processingDeviceCodes.add(device_code)

      try {
        // Success! Add token to manager
        const entry = await tokenManager.addToken(result.access_token, account_type)

        return c.json({
          status: "success",
          id: entry.id,
          username: entry.username,
          account_type: entry.accountType,
          message: `Successfully logged in as ${entry.username}`,
        })
      } finally {
        // Remove from processing set
        processingDeviceCodes.delete(device_code)
      }
    } catch (error) {
      consola.error("Failed to complete login:", error)
      return c.json(
        { error: { message: "Failed to complete login", type: "auth_error" } },
        500
      )
    }
  })

  // GET /auth/tokens - List all tokens
  app.get("/auth/tokens", (c) => {
    try {
      const stats = tokenManager.getStatistics()
      const counts = tokenManager.getTokenCount()

      return c.json({
        total: counts.total,
        active: counts.active,
        tokens: stats.map((s) => ({
          id: s.id,
          username: s.username,
          account_type: s.accountType,
          is_active: s.isActive,
          has_copilot_token: s.hasValidCopilotToken,
          copilot_token_expires_at: s.copilotTokenExpiresAt?.toISOString() ?? null,
          request_count: s.requestCount,
          error_count: s.errorCount,
          last_used: s.lastUsed?.toISOString() ?? null,
        })),
      })
    } catch (error) {
      consola.error("Failed to list tokens:", error)
      return c.json(
        { error: { message: "Failed to list tokens", type: "error" } },
        500
      )
    }
  })

  // DELETE /auth/tokens/all - Delete all tokens (for cleanup) - must be before :id route
  app.delete("/auth/tokens/all", async (c) => {
    try {
      await tokenManager.removeAllTokens()
      return c.json({ message: "All tokens deleted" })
    } catch (error) {
      consola.error("Failed to delete all tokens:", error)
      return c.json(
        { error: { message: "Failed to delete all tokens", type: "error" } },
        500
      )
    }
  })

  // DELETE /auth/tokens/:id - Delete a token
  app.delete("/auth/tokens/:id", async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10)
      
      if (isNaN(id)) {
        return c.json(
          { error: { message: "Invalid token ID", type: "validation_error" } },
          400
        )
      }

      const removed = await tokenManager.removeToken(id)
      
      if (!removed) {
        return c.json(
          { error: { message: "Token not found", type: "not_found" } },
          404
        )
      }

      return c.json({ message: "Token deleted successfully" })
    } catch (error) {
      consola.error("Failed to delete token:", error)
      return c.json(
        { error: { message: "Failed to delete token", type: "error" } },
        500
      )
    }
  })

  // POST /auth/tokens - Add token directly
  app.post("/auth/tokens", async (c) => {
    try {
      const body = await c.req.json()
      const { github_token, account_type = "individual" } = body

      if (!github_token) {
        return c.json(
          { error: { message: "github_token is required", type: "validation_error" } },
          400
        )
      }

      const entry = await tokenManager.addToken(github_token, account_type)

      return c.json({
        id: entry.id,
        username: entry.username,
        message: `Token added for ${entry.username}`,
      })
    } catch (error) {
      consola.error("Failed to add token:", error)
      return c.json(
        { error: { message: "Failed to add token", type: "error" } },
        500
      )
    }
  })
}
