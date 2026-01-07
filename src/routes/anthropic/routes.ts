import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { streamSSE } from "hono/streaming"
import consola from "consola"

import { forwardError } from "~/lib/error"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { type AnthropicMessagesPayload, type AnthropicStreamState } from "./types"
import { translateToAnthropic, translateToOpenAI } from "./translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

const AnthropicErrorResponseSchema = z.object({
  type: z.literal("error"),
  error: z.object({
    type: z.string(),
    message: z.string(),
  }),
})

// Messages route
const messagesRoute = createRoute({
  method: "post",
  path: "/messages",
  tags: ["Anthropic API"],
  summary: "Create a message with Anthropic-compatible API",
  description:
    "Create a message using the Anthropic-compatible API interface, powered by GitHub Copilot.",
  request: {
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
      description: "Successfully created message",
    },
    400: {
      content: { "application/json": { schema: AnthropicErrorResponseSchema } },
      description: "Bad request",
    },
    500: {
      content: { "application/json": { schema: AnthropicErrorResponseSchema } },
      description: "Internal server error",
    },
  },
})

// Count tokens route
const countTokensRoute = createRoute({
  method: "post",
  path: "/messages/count_tokens",
  tags: ["Anthropic API"],
  summary: "Count input tokens for Anthropic-compatible messages",
  description: "Count the input tokens for messages using the Anthropic-compatible API interface.",
  request: {
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
            input_tokens: z.number(),
          }),
        },
      },
      description: "Successfully counted input tokens",
    },
    500: {
      content: { "application/json": { schema: AnthropicErrorResponseSchema } },
      description: "Internal server error",
    },
  },
})

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

export function registerAnthropicRoutes(app: OpenAPIHono) {
  // POST /messages
  app.openapi(messagesRoute, async (c) => {
    try {
      const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
      consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

      const openAIPayload = translateToOpenAI(anthropicPayload)
      consola.debug("Translated OpenAI request payload:", JSON.stringify(openAIPayload))

      const response = await createChatCompletions(openAIPayload)

      if (isNonStreaming(response)) {
        consola.debug("Non-streaming response from Copilot")
        const anthropicResponse = translateToAnthropic(response)
        return c.json(anthropicResponse)
      }

      consola.debug("Streaming response from Copilot")
      return streamSSE(c, async (stream) => {
        const streamState: AnthropicStreamState = {
          messageStartSent: false,
          contentBlockIndex: 0,
          contentBlockOpen: false,
          toolCalls: {},
        }

        for await (const rawEvent of response) {
          if (rawEvent.data === "[DONE]") break
          if (!rawEvent.data) continue

          const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
          const events = translateChunkToAnthropicEvents(chunk, streamState)

          for (const event of events) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            })
          }
        }
      })
    } catch (error) {
      return await forwardError(c, error)
    }
  })

  // POST /messages/count_tokens
  app.openapi(countTokensRoute, async (c) => {
    try {
      const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
      const openAIPayload = translateToOpenAI(anthropicPayload)

      // Simple estimation: count characters and divide by 4
      let totalChars = 0
      for (const msg of openAIPayload.messages) {
        if (typeof msg.content === "string") {
          totalChars += msg.content.length
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              totalChars += part.text.length
            }
          }
        }
      }

      const estimatedTokens = Math.ceil(totalChars / 4)
      return c.json({ input_tokens: estimatedTokens })
    } catch (error) {
      return await forwardError(c, error)
    }
  })
}
