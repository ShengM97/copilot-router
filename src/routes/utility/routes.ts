import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"

import { state } from "~/lib/state"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

const CommonResponseError = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
  }),
})

// Token route
const tokenRoute = createRoute({
  method: "get",
  path: "/token",
  tags: ["Utility"],
  summary: "Get current Copilot token",
  description: "Returns the current Copilot authentication token.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            token: z.string().nullable(),
          }),
        },
      },
      description: "Token retrieved successfully",
    },
    500: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Internal server error",
    },
  },
})

// Usage route
const usageRoute = createRoute({
  method: "get",
  path: "/usage",
  tags: ["Utility"],
  summary: "Get Copilot usage statistics",
  description: "Returns the current Copilot usage and quota information.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough(),
        },
      },
      description: "Usage retrieved successfully",
    },
    500: {
      content: { "application/json": { schema: CommonResponseError } },
      description: "Internal server error",
    },
  },
})

// Health check route
const healthRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Utility"],
  summary: "Health check",
  description: "Returns server health status.",
  responses: {
    200: {
      content: {
        "text/plain": {
          schema: z.string(),
        },
      },
      description: "Server is healthy",
    },
  },
})

export function registerUtilityRoutes(app: OpenAPIHono) {
  // GET /
  app.openapi(healthRoute, (c) => {
    return c.text("Copilot Router is running")
  })

  // GET /token
  app.openapi(tokenRoute, (c) => {
    try {
      return c.json({
        token: state.copilotToken ?? null,
      })
    } catch (error) {
      console.error("Error fetching token:", error)
      return c.json({ error: { message: "Failed to fetch token", type: "error" } }, 500)
    }
  })

  // GET /usage
  app.openapi(usageRoute, async (c) => {
    try {
      const usage = await getCopilotUsage()
      return c.json(usage)
    } catch (error) {
      console.error("Error fetching Copilot usage:", error)
      return c.json({ error: { message: "Failed to fetch Copilot usage", type: "error" } }, 500)
    }
  })
}
