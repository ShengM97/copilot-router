import { standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export const GITHUB_BASE_URL = "https://github.com"
// GitHub CLI (gh) OAuth App Client ID
export const GITHUB_CLIENT_ID = "178c6fc778ccc68e1d6a"
// Scopes matching `gh auth login` defaults
export const GITHUB_APP_SCOPES = ["gist", "read:org", "repo"].join(" ")

export async function getDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(`${GITHUB_BASE_URL}/login/device/code`, {
    method: "POST",
    headers: standardHeaders(),
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_APP_SCOPES,
    }),
  })

  if (!response.ok) {
    throw new HTTPError("Failed to get device code", response)
  }

  return (await response.json()) as DeviceCodeResponse
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}
