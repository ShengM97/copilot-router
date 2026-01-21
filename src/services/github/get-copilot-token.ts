import { GITHUB_API_BASE_URL, standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import consola from "consola"

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

/**
 * Get Copilot token for a specific GitHub token
 */
export const getCopilotTokenForGithubToken = async (
  githubToken: string,
  vsCodeVersion: string,
  accountType: string = "individual"
): Promise<GetCopilotTokenResponse> => {
  const url = `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`
  const headers = createGithubHeaders(githubToken, vsCodeVersion)
  
  consola.debug("Fetching Copilot token from:", url)
  consola.debug("Using GitHub token:", githubToken.substring(0, 15) + "...")
  
  const response = await fetch(url, { headers })

  if (!response.ok) {
    const text = await response.text()
    consola.error("Response status:", response.status)
    consola.error("Response body:", text)
    throw new HTTPError("Failed to get Copilot token", response)
  }

  return (await response.json()) as GetCopilotTokenResponse
}

export interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
