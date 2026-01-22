import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { streamSSE } from "hono/streaming"
import consola from "consola"

import { forwardError } from "~/lib/error"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { type GeminiGenerateContentRequest } from "./types"
import {
  translateGeminiToOpenAI,
  translateOpenAIToGemini,
  translateChunkToGemini,
} from "./translation"

const GeminiErrorResponseSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string(),
  }),
})

// Generate content route (non-streaming)
const generateContentRoute = createRoute({
  method: "post",
  path: "/models/:modelWithMethod",
  tags: ["Gemini API"],
  summary: "Generate content with Gemini-compatible API",
  description:
    "Generate content using the Gemini-compatible API interface, powered by GitHub Copilot.",
  request: {
    params: z.object({
      modelWithMethod: z.string(),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough(),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough(),
        },
        "text/event-stream": {
          schema: z.string(),
        },
      },
      description: "Successfully generated content",
    },
    400: {
      content: { "application/json": { schema: GeminiErrorResponseSchema } },
      description: "Bad request",
    },
    500: {
      content: { "application/json": { schema: GeminiErrorResponseSchema } },
      description: "Internal server error",
    },
  },
})

// Count tokens route
const countTokensRoute = createRoute({
  method: "post",
  path: "/models/:modelWithMethod",
  tags: ["Gemini API"],
  summary: "Count tokens for Gemini-compatible request",
  description: "Count the tokens for a request using the Gemini-compatible API interface.",
  request: {
    params: z.object({
      modelWithMethod: z.string(),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough(),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            totalTokens: z.number(),
          }),
        },
      },
      description: "Successfully counted tokens",
    },
    500: {
      content: { "application/json": { schema: GeminiErrorResponseSchema } },
      description: "Internal server error",
    },
  },
})

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

function parseModelFromPath(modelWithMethod: string): { model: string; method: string } {
  // Format: gemini-2.5-pro:generateContent or gemini-2.5-pro:streamGenerateContent
  const colonIndex = modelWithMethod.lastIndexOf(":")
  if (colonIndex === -1) {
    return { model: modelWithMethod, method: "generateContent" }
  }
  return {
    model: modelWithMethod.substring(0, colonIndex),
    method: modelWithMethod.substring(colonIndex + 1),
  }
}

export function registerGeminiRoutes(app: OpenAPIHono) {
  // Handle all Gemini routes with pattern matching
  app.post("/models/:modelWithMethod", async (c) => {
    try {
      const modelWithMethod = c.req.param("modelWithMethod")
      const { model, method } = parseModelFromPath(modelWithMethod)

      consola.debug(`Gemini request: model=${model}, method=${method}`)

      const geminiPayload = await c.req.json<GeminiGenerateContentRequest>()

      if (method === "countTokens") {
        // Simple token estimation
        let totalChars = 0
        if (geminiPayload.contents) {
          for (const content of geminiPayload.contents) {
            for (const part of content.parts || []) {
              if (part.text) {
                totalChars += part.text.length
              }
            }
          }
        }
        if (geminiPayload.systemInstruction) {
          for (const part of geminiPayload.systemInstruction.parts || []) {
            if (part.text) {
              totalChars += part.text.length
            }
          }
        }
        const estimatedTokens = Math.ceil(totalChars / 4)
        return c.json({ totalTokens: estimatedTokens })
      }

      const isStreaming = method === "streamGenerateContent"
      const openAIPayload = translateGeminiToOpenAI(geminiPayload, model)
      openAIPayload.stream = isStreaming

      consola.debug("Translated OpenAI payload:", JSON.stringify(openAIPayload))

      const response = await createChatCompletions(openAIPayload)

      if (isNonStreaming(response)) {
        const geminiResponse = translateOpenAIToGemini(response)
        return c.json(geminiResponse)
      }

      // Streaming response
      return streamSSE(c, async (stream) => {
        for await (const rawEvent of response) {
          if (rawEvent.data === "[DONE]") break
          if (!rawEvent.data) continue

          const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
          const geminiChunk = translateChunkToGemini(chunk)

          if (geminiChunk.candidates && geminiChunk.candidates.length > 0) {
            await stream.writeSSE({
              data: JSON.stringify(geminiChunk),
            })
          }
        }
      })
    } catch (error) {
      return await forwardError(c, error)
    }
  })
}
