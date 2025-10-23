import { createClerkClient } from "@clerk/chrome-extension/background"

let clerkPromise: ReturnType<typeof createClerkClient> | null = null

function getPublishableKey(): string {
  const key = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
  if (!key) {
    throw new Error("Missing PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable")
  }
  return key
}

function getSyncHost(): string | undefined {
  return process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST
}

async function getClerk() {
  if (!clerkPromise) {
    clerkPromise = createClerkClient({
      publishableKey: getPublishableKey(),
      syncHost: getSyncHost()
    })
  }

  return clerkPromise
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const clerk = await getClerk()
  const session = clerk.session

  if (!session) {
    throw new Error("You must be signed in to upload captures")
  }

  const token = await session.getToken()
  if (!token) {
    throw new Error("Failed to obtain authentication token")
  }

  return {
    Authorization: `Bearer ${token}`
  }
}

export async function getSessionToken(): Promise<string> {
  const headers = await getAuthHeaders()
  const token = headers.Authorization?.replace(/^Bearer\s+/i, "")
  if (!token) {
    throw new Error("Authentication token missing from headers")
  }
  return token
}
