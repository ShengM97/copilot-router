import {
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type Message,
  type Tool,
  type ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

import {
  type GeminiGenerateContentRequest,
  type GeminiGenerateContentResponse,
  type GeminiContent,
  type GeminiPart,
  type GeminiCandidate,
} from "./types"

// Gemini -> OpenAI translation

export function translateGeminiToOpenAI(
  request: GeminiGenerateContentRequest,
  model: string,
): ChatCompletionsPayload {
  const messages: Message[] = []

  // Handle system instruction
  if (request.systemInstruction) {
    const systemText = request.systemInstruction.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n")
    if (systemText) {
      messages.push({ role: "system", content: systemText })
    }
  }

  // Handle contents
  if (request.contents) {
    for (const content of request.contents) {
      const role = content.role === "model" ? "assistant" : "user"
      const parts = content.parts || []

      // Check for function calls/responses
      const functionCalls = parts.filter((p) => p.functionCall)
      const functionResponses = parts.filter((p) => p.functionResponse)
      const textParts = parts.filter((p) => p.text)

      if (functionCalls.length > 0) {
        // Assistant with tool calls
        const textContent = textParts.map((p) => p.text).join("\n") || null
        messages.push({
          role: "assistant",
          content: textContent,
          tool_calls: functionCalls.map((p, idx) => ({
            id: p.functionCall!.id || `call_${idx}`,
            type: "function" as const,
            function: {
              name: p.functionCall!.name,
              arguments: JSON.stringify(p.functionCall!.args || {}),
            },
          })),
        })
      } else if (functionResponses.length > 0) {
        // Tool results
        for (const p of functionResponses) {
          messages.push({
            role: "tool",
            tool_call_id: p.functionResponse!.id,
            content: JSON.stringify(p.functionResponse!.response || ""),
          })
        }
      } else {
        // Regular text message
        const textContent = textParts.map((p) => p.text).join("\n") || ""
        
        // Handle inline data (images)
        const imageParts = parts.filter((p) => p.inlineData)
        if (imageParts.length > 0) {
          messages.push({
            role: role as "user" | "assistant",
            content: [
              ...textParts.map((p) => ({ type: "text" as const, text: p.text! })),
              ...imageParts.map((p) => ({
                type: "image_url" as const,
                image_url: {
                  url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}`,
                },
              })),
            ],
          })
        } else {
          messages.push({
            role: role as "user" | "assistant",
            content: textContent,
          })
        }
      }
    }
  }

  // Translate tools
  let tools: Tool[] | undefined
  if (request.tools) {
    tools = []
    for (const tool of request.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description,
              parameters: func.parameters || {},
            },
          })
        }
      }
    }
  }

  // Translate tool config
  let tool_choice: ChatCompletionsPayload["tool_choice"]
  if (request.toolConfig?.functionCallingConfig?.mode) {
    const mode = request.toolConfig.functionCallingConfig.mode
    if (mode === "AUTO") tool_choice = "auto"
    else if (mode === "ANY") tool_choice = "required"
    else if (mode === "NONE") tool_choice = "none"
  }

  return {
    model,
    messages,
    temperature: request.generationConfig?.temperature,
    top_p: request.generationConfig?.topP,
    max_tokens: request.generationConfig?.maxOutputTokens,
    stop: request.generationConfig?.stopSequences,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice,
  }
}

// OpenAI -> Gemini translation

export function translateOpenAIToGemini(
  response: ChatCompletionResponse,
): GeminiGenerateContentResponse {
  const candidates: GeminiCandidate[] = []

  for (const choice of response.choices) {
    const parts: GeminiPart[] = []

    // Handle text content
    if (choice.message.content) {
      parts.push({ text: choice.message.content })
    }

    // Handle tool calls
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments),
          },
        })
      }
    }

    const content: GeminiContent = {
      parts,
      role: "model",
    }

    const finishReasonMap: Record<string, GeminiCandidate["finishReason"]> = {
      stop: "STOP",
      length: "MAX_TOKENS",
      tool_calls: "STOP",
      content_filter: "SAFETY",
    }

    candidates.push({
      content,
      finishReason: finishReasonMap[choice.finish_reason] || "OTHER",
      index: choice.index,
    })
  }

  return {
    candidates,
    usageMetadata: response.usage
      ? {
          promptTokenCount: response.usage.prompt_tokens,
          candidatesTokenCount: response.usage.completion_tokens,
          totalTokenCount: response.usage.total_tokens,
        }
      : undefined,
  }
}

// Stream chunk translation

export function translateChunkToGemini(
  chunk: ChatCompletionChunk,
): GeminiGenerateContentResponse {
  const candidates: GeminiCandidate[] = []

  for (const choice of chunk.choices) {
    const parts: GeminiPart[] = []

    if (choice.delta.content) {
      parts.push({ text: choice.delta.content })
    }

    if (choice.delta.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        if (toolCall.function?.name) {
          parts.push({
            functionCall: {
              id: toolCall.id,
              name: toolCall.function.name,
              args: toolCall.function.arguments
                ? JSON.parse(toolCall.function.arguments)
                : {},
            },
          })
        }
      }
    }

    if (parts.length > 0) {
      const finishReasonMap: Record<string, GeminiCandidate["finishReason"]> = {
        stop: "STOP",
        length: "MAX_TOKENS",
        tool_calls: "STOP",
        content_filter: "SAFETY",
      }

      candidates.push({
        content: { parts, role: "model" },
        finishReason: choice.finish_reason
          ? finishReasonMap[choice.finish_reason] || "OTHER"
          : undefined,
        index: choice.index,
      })
    }
  }

  return {
    candidates,
    usageMetadata: chunk.usage
      ? {
          promptTokenCount: chunk.usage.prompt_tokens,
          candidatesTokenCount: chunk.usage.completion_tokens,
          totalTokenCount: chunk.usage.total_tokens,
        }
      : undefined,
  }
}
