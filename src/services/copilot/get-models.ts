import { copilotBaseUrlForEntry, copilotHeadersForEntry } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { tokenManager, type TokenEntry } from "~/lib/token-manager"

export const getModels = async (tokenEntry?: TokenEntry) => {
  // Get token entry - use provided one or get first active one
  const entry = tokenEntry || tokenManager.getActiveTokenEntries()[0]
  if (!entry) throw new Error("No active tokens available")

  const response = await fetch(`${copilotBaseUrlForEntry(entry)}/models`, {
    headers: copilotHeadersForEntry(entry),
  })

  if (!response.ok) {
    tokenManager.reportError(entry.id)
    throw new HTTPError("Failed to get models", response)
  }

  return (await response.json()) as ModelsResponse
}

/**
 * Get models for all active token entries (for grouped display)
 */
export const getModelsForAllTokens = async (): Promise<TokenModelsResult[]> => {
  const entries = tokenManager.getActiveTokenEntries()
  const results: TokenModelsResult[] = []

  for (const entry of entries) {
    try {
      const models = await getModels(entry)
      results.push({
        tokenId: entry.id,
        username: entry.username,
        accountType: entry.accountType,
        models,
      })
    } catch (error) {
      results.push({
        tokenId: entry.id,
        username: entry.username,
        accountType: entry.accountType,
        models: null,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return results
}

export interface TokenModelsResult {
  tokenId: number
  username: string | null
  accountType: string
  models: ModelsResponse | null
  error?: string
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

export interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
}
