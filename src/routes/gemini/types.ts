// Gemini API Types

export interface GeminiContent {
  parts: GeminiPart[]
  role?: "user" | "model"
}

export interface GeminiPart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string
  }
  functionCall?: {
    id?: string
    name: string
    args?: Record<string, unknown>
  }
  functionResponse?: {
    id: string
    response?: unknown
  }
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[]
}

export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface GeminiToolConfig {
  functionCallingConfig?: {
    mode?: "AUTO" | "ANY" | "NONE"
    allowedFunctionNames?: string[]
  }
}

export interface GeminiGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  stopSequences?: string[]
}

export interface GeminiGenerateContentRequest {
  contents?: GeminiContent[]
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  systemInstruction?: GeminiContent
  generationConfig?: GeminiGenerationConfig
}

export interface GeminiCandidate {
  content: GeminiContent
  finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER"
  index?: number
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
  modelVersion?: string
}
