import consola from "consola"
import { standardHeaders } from "~/lib/api-config"
import {
  GITHUB_BASE_URL,
  GITHUB_CLIENT_ID,
  type DeviceCodeResponse,
} from "./get-device-code"

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check access token once (for client-side polling)
 */
export async function checkAccessToken(
  deviceCode: string,
): Promise<{ access_token?: string; error?: string; error_description?: string }> {
  const response = await fetch(
    `${GITHUB_BASE_URL}/login/oauth/access_token`,
    {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    consola.error("Failed to check access token:", text)
    return { error: "request_failed", error_description: text }
  }

  const json = await response.json() as AccessTokenResponse
  consola.debug("Check access token response:", json)

  return {
    access_token: json.access_token,
    error: json.error,
    error_description: json.error_description,
  }
}

/**
 * Poll for access token after device code flow (blocking, for CLI use)
 */
export async function pollAccessToken(
  deviceCode: DeviceCodeResponse,
): Promise<string> {
  // Interval is in seconds, we need to multiply by 1000 to get milliseconds
  // Adding another second to be safe
  const sleepDuration = (deviceCode.interval + 1) * 1000
  consola.debug(`Polling access token with interval of ${sleepDuration}ms`)

  while (true) {
    const result = await checkAccessToken(deviceCode.device_code)

    if (result.access_token) {
      return result.access_token
    } else if (result.error === "expired_token") {
      throw new Error("Device code expired. Please try again.")
    } else {
      await sleep(sleepDuration)
    }
  }
}

interface AccessTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}
