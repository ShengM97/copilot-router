import { GITHUB_API_BASE_URL, githubHeadersForEntry, standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { tokenManager, type TokenEntry } from "~/lib/token-manager"

const COPILOT_VERSION = "0.26.7"
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`
const API_VERSION = "2025-05-01"

/**
 * Create GitHub headers for a specific token
 */
function createGithubHeaders(githubToken: string, vsCodeVersion: string) {
  return {
    ...standardHeaders(),
    authorization: `token ${githubToken}`,
    "editor-version": `vscode/${vsCodeVersion}`,
    "editor-plugin-version": EDITOR_PLUGIN_VERSION,
    "user-agent": USER_AGENT,
    "x-github-api-version": API_VERSION,
    "x-vscode-user-agent-library-version": "electron-fetch",
  }
}

export const getCopilotUsage = async (tokenEntry?: TokenEntry): Promise<CopilotUsageResponse> => {
  // Get token entry - use provided one or get first active one
  const entry = tokenEntry || tokenManager.getActiveTokenEntries()[0]
  if (!entry) throw new Error("No active tokens available")

  const vsCodeVersion = tokenManager.getVSCodeVersion()
  
  console.log(`[Usage] Fetching usage for token ID ${entry.id}, user: ${entry.username}`)
  console.log(`[Usage] GitHub token: ${entry.githubToken?.substring(0, 10)}...`)
  
  const response = await fetch(`${GITHUB_API_BASE_URL}/copilot_internal/user`, {
    headers: createGithubHeaders(entry.githubToken, vsCodeVersion),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[Usage] API error: ${response.status} - ${errorBody}`)
    tokenManager.reportError(entry.id)
    throw new HTTPError("Failed to get Copilot usage", response)
  }

  return (await response.json()) as CopilotUsageResponse
}

/**
 * Get usage/quota for all active token entries (for grouped display)
 */
export const getCopilotUsageForAllTokens = async (): Promise<TokenUsageResult[]> => {
  const entries = tokenManager.getActiveTokenEntries()
  const results: TokenUsageResult[] = []

  for (const entry of entries) {
    try {
      const usage = await getCopilotUsage(entry)
      results.push({
        tokenId: entry.id,
        username: entry.username,
        accountType: entry.accountType,
        usage,
      })
    } catch (error) {
      results.push({
        tokenId: entry.id,
        username: entry.username,
        accountType: entry.accountType,
        usage: null,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return results
}

export interface TokenUsageResult {
  tokenId: number
  username: string | null
  accountType: string
  usage: CopilotUsageResponse | null
  error?: string
}

export interface QuotaDetail {
  entitlement: number
  overage_count: number
  overage_permitted: boolean
  percent_remaining: number
  quota_id: string
  quota_remaining: number
  remaining: number
  unlimited: boolean
}

interface QuotaSnapshots {
  chat: QuotaDetail
  completions: QuotaDetail
  premium_interactions: QuotaDetail
}

interface CopilotUsageResponse {
  access_type_sku: string
  analytics_tracking_id: string
  assigned_date: string
  can_signup_for_limited: boolean
  chat_enabled: boolean
  copilot_plan: string
  organization_login_list: Array<unknown>
  organization_list: Array<unknown>
  quota_reset_date: string
  quota_snapshots: QuotaSnapshots
}
