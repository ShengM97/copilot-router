import { OpenAPIHono } from "@hono/zod-openapi"

import { tokenManager } from "~/lib/token-manager"

export function registerUtilityRoutes(app: OpenAPIHono) {
  // GET /
  app.get("/", (c) => {
    const counts = tokenManager.getTokenCount()
    return c.text(`Copilot Router is running (${counts.active}/${counts.total} active tokens)`)
  })
}
