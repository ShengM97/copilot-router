import { copilotHeadersForEntry, copilotBaseUrlForEntry } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { tokenManager, type TokenEntry } from "~/lib/token-manager"

export const createEmbeddings = async (payload: EmbeddingRequest, tokenEntry?: TokenEntry) => {
  // Get token entry - use provided one or get random for load balancing
  const entry = tokenEntry || tokenManager.getRandomTokenEntry()
  if (!entry) throw new Error("No active tokens available")

  const vsCodeVersion = tokenManager.getVSCodeVersion()
  
  const response = await fetch(`${copilotBaseUrlForEntry(entry)}/embeddings`, {
    method: "POST",
    headers: copilotHeadersForEntry(entry, vsCodeVersion),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    tokenManager.reportError(entry.id)
    throw new HTTPError("Failed to create embeddings", response)
  }

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
