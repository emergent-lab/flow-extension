import { ClerkProvider, SignedIn } from "@clerk/chrome-extension"
import { Outlet, useNavigate } from "react-router"

// Get web app URL with proper port handling
function getWebAppUrl(path: string = ""): string {
  const frontendUrl =
    process.env.PLASMO_PUBLIC_FRONTEND_URL || "http://localhost:3000"
  return `${frontendUrl}${path}`
}

function RootLayout() {
  const navigate = useNavigate()
  const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY!
  const syncHost = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST!

  const openSettings = () => {
    chrome.tabs.create({ url: getWebAppUrl("/dashboard") })
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      syncHost={syncHost}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      afterSignOutUrl="/">
      <div className="plasmo-bg-background plasmo-rounded-xl plasmo-overflow-hidden">
        <header className="plasmo-border-b plasmo-border-border plasmo-px-4 plasmo-py-3 plasmo-flex plasmo-items-center plasmo-justify-between">
          <h1 className="plasmo-text-lg plasmo-font-semibold plasmo-text-foreground">
            Flow
          </h1>
          <SignedIn>
            <button
              onClick={openSettings}
              className="plasmo-text-sm plasmo-text-muted-foreground hover:plasmo-text-foreground plasmo-flex plasmo-items-center plasmo-gap-1 plasmo-transition-colors">
              <span>⚙</span>
              <span>Manage Account</span>
            </button>
          </SignedIn>
        </header>
        <main className="plasmo-p-4">
          <Outlet />
        </main>
      </div>
    </ClerkProvider>
  )
}

export default RootLayout
