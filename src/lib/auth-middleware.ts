import type { Context, Next } from "hono"
import { timingSafeEqual } from "crypto"
import consola from "consola"

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 */
function safeCompare(a: string, b: string): boolean {
  // Convert strings to buffers
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")

  // If lengths differ, we still need to do a comparison to maintain constant time
  // We compare bufA with itself to keep timing consistent
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }

  return timingSafeEqual(bufA, bufB)
}
/**
 * API Key authentication middleware
 * 
 * This middleware validates the API key from the Authorization header.
 * If API_KEY environment variable is not set, all requests are allowed.
 * If API_KEY is set, requests must include a valid Bearer token that matches.
 * 
 * Expected header format: Authorization: Bearer <API_KEY>
 */
export function apiKeyAuth() {
  const apiKey = process.env.API_KEY
  return async (c: Context, next: Next) => {
    // If no API key is configured, allow all requests
    if (!apiKey) {
      return next()
    }
    const authHeader = c.req.header("Authorization")
    // Check for Authorization header
    if (!authHeader) {
      consola.warn("API request without Authorization header")
      return c.json(
        {
          error: {
            message: "Missing Authorization header. Please provide your API key as 'Bearer <API_KEY>'",
            type: "authentication_error",
            code: "missing_api_key",
          },
        },
        401,
      )
    }
    // Parse Bearer token
    const parts = authHeader.split(" ")
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      consola.warn("Invalid Authorization header format")
      return c.json(
        {
          error: {
            message: "Invalid Authorization header format. Expected 'Bearer <API_KEY>'",
            type: "authentication_error",
            code: "invalid_api_key_format",
          },
        },
        401,
      )
    }
    const providedKey = parts[1]
    // Validate API key using constant-time comparison to prevent timing attacks
    if (!safeCompare(providedKey, apiKey)) {
      consola.warn("Invalid API key provided")
      return c.json(
        {
          error: {
            message: "Invalid API key provided",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        },
        401,
      )
    }
    // API key is valid, proceed
    return next()
  }
}
/**
 * Check if API key authentication is enabled
 */
export function isApiKeyEnabled(): boolean {
  return !!process.env.API_KEY
}
