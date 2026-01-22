import type { TokenEntry } from "./token-manager"

export const standardHeaders = () => ({
  "content-type": "application/json",
  accept: "application/json",
})

const COPILOT_VERSION = "0.0.388"
const API_VERSION = "2025-05-01"

/**
 * Get base URL for token entry
 */
export const copilotBaseUrlForEntry = (entry: TokenEntry) =>
  entry.accountType === "individual"
    ? "https://api.githubcopilot.com"
    : `https://api.${entry.accountType}.githubcopilot.com`

/**
 * Create headers for a token entry
 * Note: Using GitHub Access Token directly instead of Copilot Token
 */
export const copilotHeadersForEntry = (entry: TokenEntry, vision: boolean = false) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${entry.githubToken}`,
    "content-type": standardHeaders()["content-type"],
    "copilot-integration-id": "copilot-developer-cli",
    "user-agent": `copilot/${COPILOT_VERSION} (linux v24.11.1) term/unknown`,
    "openai-intent": "conversation-agent",
    "x-github-api-version": API_VERSION,
  }

  if (vision) headers["copilot-vision-request"] = "true"

  return headers
}

export const GITHUB_API_BASE_URL = "https://api.github.com"
