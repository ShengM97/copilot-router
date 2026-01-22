/**
 * Utility functions for copilot-router
 * Note: Token management has been moved to token-manager.ts
 */

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
