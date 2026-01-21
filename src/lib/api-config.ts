import { randomUUID } from "node:crypto"

import type { State } from "./state"
import type { TokenEntry } from "./token-manager"

export const standardHeaders = () => ({
  "content-type": "application/json",
  accept: "application/json",
})

const COPILOT_VERSION = "0.26.7"
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`

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
 */
export const copilotHeadersForEntry = (entry: TokenEntry, vsCodeVersion: string, vision: boolean = false) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${entry.copilotToken}`,
    "content-type": standardHeaders()["content-type"],
    "copilot-integration-id": "copilot-developer-cli",
    "editor-version": `vscode/${vsCodeVersion}`,
    "editor-plugin-version": EDITOR_PLUGIN_VERSION,
    "user-agent": USER_AGENT,
    "openai-intent": "conversation-panel",
    "x-github-api-version": API_VERSION,
    "x-request-id": randomUUID(),
    "x-vscode-user-agent-library-version": "electron-fetch",
  }

  if (vision) headers["copilot-vision-request"] = "true"

  return headers
}

/**
 * Create GitHub headers for a token entry
 */
export const githubHeadersForEntry = (entry: TokenEntry, vsCodeVersion: string) => ({
  ...standardHeaders(),
  authorization: `token ${entry.githubToken}`,
  "editor-version": `vscode/${vsCodeVersion}`,
  "editor-plugin-version": EDITOR_PLUGIN_VERSION,
  "user-agent": USER_AGENT,
  "x-github-api-version": API_VERSION,
  "x-vscode-user-agent-library-version": "electron-fetch",
})

// Legacy: Keep old functions for backward compatibility
export const copilotBaseUrl = (state: State) =>
  state.accountType === "individual"
    ? "https://api.githubcopilot.com"
    : `https://api.${state.accountType}.githubcopilot.com`

export const copilotHeaders = (state: State, vision: boolean = false) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${state.copilotToken}`,
    "content-type": standardHeaders()["content-type"],
    "copilot-integration-id": "copilot-developer-cli",
    "editor-version": `vscode/${state.vsCodeVersion}`,
    "editor-plugin-version": EDITOR_PLUGIN_VERSION,
    "user-agent": USER_AGENT,
    "openai-intent": "conversation-panel",
    "x-github-api-version": API_VERSION,
    "x-request-id": randomUUID(),
    "x-vscode-user-agent-library-version": "electron-fetch",
  }

  if (vision) headers["copilot-vision-request"] = "true"

  return headers
}

export const GITHUB_API_BASE_URL = "https://api.github.com"

export const githubHeaders = (state: State) => ({
  ...standardHeaders(),
  authorization: `token ${state.githubToken}`,
  "editor-version": `vscode/${state.vsCodeVersion}`,
  "editor-plugin-version": EDITOR_PLUGIN_VERSION,
  "user-agent": USER_AGENT,
  "x-github-api-version": API_VERSION,
  "x-vscode-user-agent-library-version": "electron-fetch",
})
