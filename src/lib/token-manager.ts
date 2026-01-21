import consola from "consola"
import { randomUUID } from "node:crypto"

import {
  getAllTokens,
  saveToken,
  updateCopilotToken,
  updateGithubToken,
  getTokenById,
  deactivateToken,
  type TokenRecord,
} from "./database"
import { getCopilotTokenForGithubToken } from "~/services/github/get-copilot-token"
import { getGitHubUserForToken } from "~/services/github/get-user"
import type { ModelsResponse } from "~/services/copilot/get-models"

/**
 * Token entry with runtime state
 */
export interface TokenEntry {
  id: number
  githubToken: string
  username: string | null
  copilotToken: string | null
  copilotTokenExpiresAt: Date | null
  accountType: string
  isActive: boolean
  models?: ModelsResponse
  lastUsed?: Date
  requestCount: number
  errorCount: number
}

/**
 * Token Manager - Manages multiple GitHub tokens with load balancing
 */
class TokenManager {
  private tokens: Map<number, TokenEntry> = new Map()
  private roundRobinIndex: number = 0
  private vsCodeVersion: string = "1.96.2"

  /**
   * Get VS Code version
   */
  getVSCodeVersion(): string {
    return this.vsCodeVersion
  }

  /**
   * Get all token entries
   */
  getAllTokenEntries(): TokenEntry[] {
    return Array.from(this.tokens.values())
  }

  /**
   * Get active token entries only
   */
  getActiveTokenEntries(): TokenEntry[] {
    return this.getAllTokenEntries().filter(t => t.isActive && t.copilotToken)
  }

  /**
   * Get a random active token entry for load balancing
   */
  getRandomTokenEntry(): TokenEntry | null {
    const activeTokens = this.getActiveTokenEntries()
    if (activeTokens.length === 0) return null

    const randomIndex = Math.floor(Math.random() * activeTokens.length)
    const token = activeTokens[randomIndex]
    token.lastUsed = new Date()
    token.requestCount++
    return token
  }

  /**
   * Get next token using round-robin for load balancing
   */
  getNextTokenEntry(): TokenEntry | null {
    const activeTokens = this.getActiveTokenEntries()
    if (activeTokens.length === 0) return null

    this.roundRobinIndex = this.roundRobinIndex % activeTokens.length
    const token = activeTokens[this.roundRobinIndex]
    this.roundRobinIndex++
    
    token.lastUsed = new Date()
    token.requestCount++
    return token
  }

  /**
   * Get a specific token entry by ID
   */
  getTokenEntryById(id: number): TokenEntry | undefined {
    return this.tokens.get(id)
  }

  /**
   * Load tokens from database
   */
  async loadFromDatabase(): Promise<void> {
    const dbTokens = await getAllTokens()
    
    for (const record of dbTokens) {
      const entry: TokenEntry = {
        id: record.id,
        githubToken: record.github_token,
        username: record.username,
        copilotToken: record.copilot_token,
        copilotTokenExpiresAt: record.copilot_token_expires_at,
        accountType: record.account_type,
        isActive: record.is_active,
        requestCount: 0,
        errorCount: 0,
      }
      this.tokens.set(record.id, entry)
    }

    consola.info(`Loaded ${this.tokens.size} tokens from database`)
  }

  /**
   * Add a new token (from VSCode login)
   */
  async addToken(githubToken: string, accountType: string = "individual"): Promise<TokenEntry> {
    // Get user info first to validate token
    consola.debug(`addToken: Validating GitHub token: ${githubToken.substring(0, 15)}...`)
    const user = await getGitHubUserForToken(githubToken)
    const username = user.login
    consola.debug(`addToken: Token belongs to user: ${username}`)

    // Check if token for this user already exists
    const existingEntry = Array.from(this.tokens.values()).find(t => t.username === username)
    if (existingEntry) {
      // Update existing entry with new token
      consola.debug(`addToken: Updating existing entry for ${username}, old token: ${existingEntry.githubToken.substring(0, 15)}...`)
      existingEntry.githubToken = githubToken
      existingEntry.isActive = true
      existingEntry.errorCount = 0
      
      // Update in database
      await updateGithubToken(existingEntry.id, githubToken)
      
      // Refresh Copilot token - don't throw on failure
      try {
        await this.refreshCopilotTokenForEntry(existingEntry)
      } catch (e) {
        consola.warn(`addToken: Failed to refresh Copilot token for ${username}, but token was saved`)
      }
      
      consola.info(`Updated token for existing user: ${username}`)
      return existingEntry
    }

    // Save to database
    const id = await saveToken(githubToken, username, accountType)
    consola.debug(`addToken: Saved new token with ID ${id}`)

    // Create token entry
    const entry: TokenEntry = {
      id,
      githubToken,
      username,
      copilotToken: null,
      copilotTokenExpiresAt: null,
      accountType,
      isActive: true,
      requestCount: 0,
      errorCount: 0,
    }

    this.tokens.set(id, entry)

    // Fetch Copilot token - don't throw on failure
    try {
      await this.refreshCopilotTokenForEntry(entry)
    } catch (e) {
      consola.warn(`addToken: Failed to refresh Copilot token for new user ${username}, but token was saved`)
    }

    consola.success(`Added token for user: ${username}`)
    return entry
  }

  /**
   * Refresh Copilot token for a specific entry
   */
  async refreshCopilotTokenForEntry(entry: TokenEntry): Promise<void> {
    try {
      const response = await getCopilotTokenForGithubToken(
        entry.githubToken,
        this.vsCodeVersion,
        entry.accountType
      )
      
      entry.copilotToken = response.token
      entry.copilotTokenExpiresAt = new Date(response.expires_at * 1000)
      entry.errorCount = 0

      // Update in database
      await updateCopilotToken(entry.id, response.token, entry.copilotTokenExpiresAt)

      consola.debug(`Refreshed Copilot token for ${entry.username}`)
    } catch (error) {
      entry.errorCount++
      // Clear copilot token on failure so this token won't be used
      entry.copilotToken = null
      entry.copilotTokenExpiresAt = null
      
      consola.error(`Failed to refresh Copilot token for ${entry.username}:`, error)
      
      // Deactivate if too many errors
      if (entry.errorCount >= 3) {
        entry.isActive = false
        await deactivateToken(entry.id)
        consola.warn(`Deactivated token for ${entry.username} due to errors`)
      }
      
      throw error
    }
  }

  /**
   * Refresh all Copilot tokens
   */
  async refreshAllCopilotTokens(): Promise<void> {
    const entries = Array.from(this.tokens.values())
    
    for (const entry of entries) {
      if (!entry.isActive) continue
      
      try {
        await this.refreshCopilotTokenForEntry(entry)
      } catch (error) {
        // Error already logged in refreshCopilotTokenForEntry
      }
    }
  }

  /**
   * Remove a token
   */
  async removeToken(id: number): Promise<boolean> {
    const entry = this.tokens.get(id)
    if (!entry) return false

    await deactivateToken(id)
    this.tokens.delete(id)
    
    consola.info(`Removed token for user: ${entry.username}`)
    return true
  }

  /**
   * Remove all tokens (for cleanup)
   */
  async removeAllTokens(): Promise<void> {
    const { deleteAllTokens } = await import("./database")
    const count = await deleteAllTokens()
    this.tokens.clear()
    consola.info(`Removed ${count} tokens`)
  }

  /**
   * Report an error for a token (for tracking)
   */
  reportError(id: number): void {
    const entry = this.tokens.get(id)
    if (entry) {
      entry.errorCount++
    }
  }

  /**
   * Get token count
   */
  getTokenCount(): { total: number; active: number } {
    const entries = Array.from(this.tokens.values())
    return {
      total: entries.length,
      active: entries.filter(t => t.isActive && t.copilotToken).length,
    }
  }

  /**
   * Get statistics for all tokens
   */
  getStatistics(): TokenStatistics[] {
    return Array.from(this.tokens.values()).map(entry => ({
      id: entry.id,
      username: entry.username,
      accountType: entry.accountType,
      isActive: entry.isActive,
      hasValidCopilotToken: !!entry.copilotToken,
      copilotTokenExpiresAt: entry.copilotTokenExpiresAt,
      requestCount: entry.requestCount,
      errorCount: entry.errorCount,
      lastUsed: entry.lastUsed,
    }))
  }
}

export interface TokenStatistics {
  id: number
  username: string | null
  accountType: string
  isActive: boolean
  hasValidCopilotToken: boolean
  copilotTokenExpiresAt: Date | null
  requestCount: number
  errorCount: number
  lastUsed?: Date
}

// Singleton instance
export const tokenManager = new TokenManager()
