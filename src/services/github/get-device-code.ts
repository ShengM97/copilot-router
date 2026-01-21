import { standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export const GITHUB_BASE_URL = "https://github.com"
export const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98"
export const GITHUB_APP_SCOPES = ["read:user"].join(" ")

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
