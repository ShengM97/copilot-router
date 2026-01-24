import consola from "consola"

import {
  getAllTokens,
  saveToken,
  updateGithubToken,
  deactivateToken,
  isDatabaseConnected,
  type TokenRecord,
} from "./database"
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
  private nextMemoryId: number = 1 // For generating IDs in memory-only mode

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
    return this.getAllTokenEntries().filter(t => t.isActive)
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
   * Load tokens from database (only if database is connected)
   */
  async loadFromDatabase(): Promise<void> {
    if (!isDatabaseConnected()) {
      consola.info("Database not connected, starting with empty token list")
      return
    }

    const dbTokens = await getAllTokens()

    for (const record of dbTokens) {
      const entry: TokenEntry = {
        id: record.Id,
        githubToken: record.Token,
        username: record.UserName,
        copilotToken: null,
        copilotTokenExpiresAt: null,
        accountType: record.AccountType,
        isActive: record.IsActive,
        requestCount: 0,
        errorCount: 0,
      }
      this.tokens.set(record.Id, entry)
      // Update nextMemoryId to avoid conflicts
      if (record.Id >= this.nextMemoryId) {
        this.nextMemoryId = record.Id + 1
      }
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

      // Update in database if connected
      if (isDatabaseConnected()) {
        await updateGithubToken(existingEntry.id, githubToken)
      }

      consola.info(`Updated token for existing user: ${username}`)
      return existingEntry
    }

    // Generate ID - from database or memory
    let id: number
    if (isDatabaseConnected()) {
      id = await saveToken(githubToken, username, accountType)
      consola.debug(`addToken: Saved new token with ID ${id}`)
    } else {
      id = this.nextMemoryId++
      consola.debug(`addToken: Generated memory ID ${id}`)
    }

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

    consola.success(`Added token for user: ${username}`)
    return entry
  }

  /**
   * Remove a token
   */
  async removeToken(id: number): Promise<boolean> {
    const entry = this.tokens.get(id)
    if (!entry) return false

    // Deactivate in database if connected
    if (isDatabaseConnected()) {
      await deactivateToken(id)
    }
    this.tokens.delete(id)

    consola.info(`Removed token for user: ${entry.username}`)
    return true
  }

  /**
   * Remove all tokens (for cleanup)
   */
  async removeAllTokens(): Promise<void> {
    if (isDatabaseConnected()) {
      const { deleteAllTokens } = await import("./database")
      const count = await deleteAllTokens()
      consola.info(`Removed ${count} tokens from database`)
    }
    this.tokens.clear()
    consola.info("Cleared all tokens from memory")
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
