import fs from "node:fs"
import path from "node:path"
import os from "node:os"

import consola from "consola"
import YAML from "yaml"

import { state } from "./state"
import { getModels } from "~/services/copilot/get-models"
import { getCopilotToken } from "~/services/github/get-copilot-token"

/**
 * Read GitHub token from copilot-api storage first, then fallback to GitHub CLI
 */
export function readGitHubToken(): string | undefined {
  // First, try to read from copilot-api's token storage
  const copilotApiTokenPath = path.join(
    os.homedir(),
    ".local",
    "share",
    "copilot-api",
    "github_token"
  )

  try {
    if (fs.existsSync(copilotApiTokenPath)) {
      const token = fs.readFileSync(copilotApiTokenPath, "utf-8").trim()
      if (token) {
        consola.success("GitHub token loaded from copilot-api storage")
        return token
      }
    }
  } catch (error) {
    consola.debug("Could not read from copilot-api storage:", error)
  }

  // Fallback to GitHub CLI hosts.yml
  const hostsPath = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "GitHub CLI",
    "hosts.yml"
  )

  try {
    if (!fs.existsSync(hostsPath)) {
      consola.warn(`GitHub CLI hosts.yml not found at: ${hostsPath}`)
      return undefined
    }

    const content = fs.readFileSync(hostsPath, "utf-8")
    const hosts = YAML.parse(content)

    // Try to get oauth_token directly from github.com
    let githubToken = hosts?.["github.com"]?.oauth_token

    // If not found, try to get from the current user
    if (!githubToken) {
      const currentUser = hosts?.["github.com"]?.user
      if (currentUser) {
        githubToken = hosts?.["github.com"]?.users?.[currentUser]?.oauth_token
      }
    }

    if (githubToken) {
      consola.success("GitHub token loaded from GitHub CLI")
      return githubToken
    }

    consola.warn("No oauth_token found in hosts.yml")
    return undefined
  } catch (error) {
    consola.error("Failed to read GitHub token:", error)
    return undefined
  }
}

/**
 * Initialize state with GitHub token and fetch Copilot token
 */
export async function initializeState() {
  // Read GitHub token
  state.githubToken = readGitHubToken()
  if (!state.githubToken) {
    throw new Error("GitHub token not found. Please login with GitHub CLI first.")
  }

  consola.info("GitHub token found:", state.githubToken.substring(0, 10) + "...")

  // Set VS Code version
  state.vsCodeVersion = "1.96.2"

  // Fetch Copilot token
  consola.info("Fetching Copilot token...")
  try {
    const tokenResponse = await getCopilotToken()
    state.copilotToken = tokenResponse.token
    consola.success("Copilot token obtained")
  } catch (error) {
    consola.error("Error details:", error)
    throw error
  }

  // Cache models
  consola.info("Fetching models...")
  state.models = await getModels()
  consola.success(`Loaded ${state.models.data.length} models`)
}

/**
 * Refresh Copilot token
 */
export async function refreshCopilotToken() {
  try {
    const tokenResponse = await getCopilotToken()
    state.copilotToken = tokenResponse.token
    consola.info("Copilot token refreshed")
  } catch (error) {
    consola.error("Failed to refresh Copilot token:", error)
  }
}
