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
 * This middleware validates the API key from various header formats:
 * - Authorization: Bearer <API_KEY> (OpenAI style)
 * - x-api-key: <API_KEY> (Anthropic style)
 * - x-goog-api-key: <API_KEY> (Gemini style)
 * 
 * If API_KEY environment variable is not set, all requests are allowed.
 */
export function apiKeyAuth() {
  const apiKey = process.env.API_KEY
  return async (c: Context, next: Next) => {
    // If no API key is configured, allow all requests
    if (!apiKey) {
      return next()
    }

    // Try to extract API key from various headers
    let providedKey: string | undefined

    // 1. Check Authorization header (OpenAI style: Bearer token)
    const authHeader = c.req.header("Authorization")
    if (authHeader) {
      const parts = authHeader.split(" ")
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        providedKey = parts[1]
      }
    }

    // 2. Check x-api-key header (Anthropic style)
    if (!providedKey) {
      providedKey = c.req.header("x-api-key")
    }

    // 3. Check x-goog-api-key header (Gemini style)
    if (!providedKey) {
      providedKey = c.req.header("x-goog-api-key")
    }

    // No API key found in any supported header
    if (!providedKey) {
      consola.warn("API request without valid API key header")
      return c.json(
        {
          error: {
            message: "Missing API key. Please provide your API key via 'Authorization: Bearer <key>', 'x-api-key: <key>', or 'x-goog-api-key: <key>'",
            type: "authentication_error",
            code: "missing_api_key",
          },
        },
        401,
      )
    }

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
