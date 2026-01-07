import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { streamSSE, type SSEMessage } from "hono/streaming"
import consola from "consola"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

const CommonResponseError = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
  }),
})

// Chat completions route
const chatCompletionsRoute = createRoute({
  method: "post",
  path: "/chat/completions",
  tags: ["OpenAI API"],
  summary: "Create a chat completion",
  description: "Create a chat completion using the OpenAI-compatible API interface.",
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
      description: "Successfully created chat completion",
    },
    400: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Bad request",
    },
    500: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Internal server error",
    },
  },
})

// Models route
const modelsRoute = createRoute({
  method: "get",
  path: "/models",
  tags: ["OpenAI API"],
  summary: "List available models",
  description: "List all available models from GitHub Copilot.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            object: z.string(),
            data: z.array(z.object({}).passthrough()),
            has_more: z.boolean(),
          }),
        },
      },
      description: "Successfully retrieved models",
    },
    500: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Internal server error",
    },
  },
})

// Embeddings route
const embeddingsRoute = createRoute({
  method: "post",
  path: "/embeddings",
  tags: ["OpenAI API"],
  summary: "Create embeddings",
  description: "Create embeddings for the provided input text.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            input: z.union([z.string(), z.array(z.string())]),
            model: z.string(),
          }),
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
      },
      description: "Successfully created embeddings",
    },
    500: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Internal server error",
    },
  },
})

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

export function registerOpenAIRoutes(app: OpenAPIHono) {
  // POST /chat/completions
  app.openapi(chatCompletionsRoute, async (c) => {
    try {
      const payload = await c.req.json<ChatCompletionsPayload>()
      consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

      const selectedModel = state.models?.data.find(
        (model) => model.id === payload.model,
      )

      if (!payload.max_tokens && selectedModel) {
        payload.max_tokens = selectedModel.capabilities.limits.max_output_tokens
      }

      const response = await createChatCompletions(payload)

      if (isNonStreaming(response)) {
        consola.debug("Non-streaming response")
        return c.json(response)
      }

      consola.debug("Streaming response")
      return streamSSE(c, async (stream) => {
        for await (const chunk of response) {
          consola.debug("Streaming chunk:", JSON.stringify(chunk))
          await stream.writeSSE(chunk as SSEMessage)
        }
      })
    } catch (error) {
      return await forwardError(c, error)
    }
  })

  // GET /models
  app.openapi(modelsRoute, async (c) => {
    try {
      const models = state.models?.data.map((model) => ({
        id: model.id,
        object: "model",
        type: "model",
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: model.vendor,
        display_name: model.name,
      }))

      return c.json({
        object: "list",
        data: models,
        has_more: false,
      })
    } catch (error) {
      return await forwardError(c, error)
    }
  })

  // POST /embeddings
  app.openapi(embeddingsRoute, async (c) => {
    try {
      const payload = await c.req.json<EmbeddingRequest>()
      const response = await createEmbeddings(payload)
      return c.json(response)
    } catch (error) {
      return await forwardError(c, error)
    }
  })
}
