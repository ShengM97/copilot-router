import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import consola from "consola"

export const getCopilotToken = async () => {
  const url = `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`
  const headers = githubHeaders(state)
  
  consola.debug("Fetching from:", url)
  consola.debug("Headers:", JSON.stringify(headers, null, 2))
  
  const response = await fetch(url, { headers })

  if (!response.ok) {
    const text = await response.text()
    consola.error("Response status:", response.status)
    consola.error("Response body:", text)
    throw new HTTPError("Failed to get Copilot token", response)
  }

  return (await response.json()) as GetCopilotTokenResponse
}

interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
