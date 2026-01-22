import { GITHUB_API_BASE_URL, standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

/**
 * Get GitHub user info for a specific token
 */
export async function getGitHubUserForToken(githubToken: string): Promise<GithubUserResponse> {
  const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
    headers: {
      authorization: `token ${githubToken}`,
      ...standardHeaders(),
    },
  })

  if (!response.ok) {
    throw new HTTPError("Failed to get GitHub user", response)
  }

  return (await response.json()) as GithubUserResponse
}

export interface GithubUserResponse {
  login: string
  id: number
  avatar_url: string
  name: string | null
  email: string | null
}
