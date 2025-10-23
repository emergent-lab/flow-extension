import { useUser } from "@clerk/chrome-extension"
import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"

import { storage } from "~lib/storage"

interface CaptureStatus {
  isCapturing: boolean
  currentPage: number
  totalPages: number | null
  capturedCount: number
  error?: string
}

interface UploadState {
  isUploading: boolean
  currentFile: number
  totalFiles: number
  percent: number
  url: string
  error?: string
}

type UploadUIState = "idle" | "uploading" | "success" | "error"

// Get web app URL with proper port handling
function getWebAppUrl(path: string = ""): string {
  const frontendUrl =
    process.env.PLASMO_PUBLIC_FRONTEND_URL || "http://localhost:3000"
  return `${frontendUrl}${path}`
}

function HomePage() {
  const { isSignedIn, user, isLoaded } = useUser()

  // Use @plasmohq/storage for automatic state sync across extension contexts
  // IMPORTANT: Use shared storage instance to ensure same storage area ("local")
  const [status, setStatus] = useStorage<CaptureStatus | null>({
    key: "captureStatus",
    instance: storage
  })
  const [uploadState, setUploadState] = useStorage<UploadState | null>({
    key: "uploadState",
    instance: storage
  })

  const [isDocSendPage, setIsDocSendPage] = useState(false)
  const [uploadUIState, setUploadUIState] = useState<UploadUIState>("idle")

  useEffect(() => {
    // Check if current tab is a DocSend page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0]
      if (currentTab?.url?.includes("docsend.com")) {
        setIsDocSendPage(true)
      }
    })

    // Note: @plasmohq/storage automatically syncs state changes via storage events
    // No need for manual chrome.storage.local.get() or chrome.runtime.onMessage listeners
  }, [])

  // Update UI state based on upload state changes
  useEffect(() => {
    if (!uploadState) {
      setUploadUIState("idle")
      return
    }

    if (uploadState.error) {
      setUploadUIState("error")
      // Auto-dismiss error after 5 seconds and clear from storage
      const timer = setTimeout(() => {
        setUploadUIState("idle")
        setUploadState(null) // Clear from storage
      }, 5000)
      return () => clearTimeout(timer)
    }

    if (uploadState.isUploading) {
      setUploadUIState("uploading")
    } else if (uploadState.percent === 100) {
      setUploadUIState("success")
      // Auto-dismiss success after 3 seconds and clear from storage
      const timer = setTimeout(() => {
        setUploadUIState("idle")
        setUploadState(null) // Clear from storage
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [uploadState, setUploadState])

  const startCapture = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "START_CAPTURE" })
      setStatus({
        isCapturing: true,
        currentPage: 0,
        totalPages: null,
        capturedCount: 0
      })
    }
  }

  const stopCapture = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "STOP_CAPTURE" })
      setStatus(null)
    }
  }

  const openWebApp = () => {
    chrome.tabs.create({ url: getWebAppUrl("/sign-in") })
  }

  // Show loading state while Clerk checks authentication
  if (!isLoaded) {
    return (
      <div className="plasmo-min-w-[400px] plasmo-text-center plasmo-py-16 plasmo-px-4">
        <div className="plasmo-inline-block plasmo-animate-spin plasmo-rounded-full plasmo-h-8 plasmo-w-8 plasmo-border-b-2 plasmo-border-primary"></div>
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="plasmo-min-w-[400px] plasmo-text-center plasmo-py-8 plasmo-px-6">
        <h2 className="plasmo-text-xl plasmo-font-semibold plasmo-mb-3 plasmo-text-foreground">
          Welcome to Flow
        </h2>
        <p className="plasmo-text-muted-foreground plasmo-mb-6 plasmo-text-sm">
          Please sign in on the Flow web app to use the DocSend capture
          extension
        </p>
        <button
          onClick={openWebApp}
          className="plasmo-bg-primary plasmo-text-primary-foreground plasmo-px-6 plasmo-py-2.5 plasmo-rounded-lg plasmo-font-medium plasmo-transition-opacity hover:plasmo-opacity-90">
          Open Flow App
        </button>
      </div>
    )
  }

  return (
    <div className="plasmo-min-w-[400px] plasmo-px-4 plasmo-py-3">
      <h2 className="plasmo-text-xl plasmo-font-semibold plasmo-mb-4 plasmo-text-foreground">
        Welcome back, {user.firstName || "there"}!
      </h2>

      <div className="plasmo-space-y-4">
        {/* Upload Status (shown across all tabs) */}
        {uploadUIState === "uploading" && uploadState && (
          <div className="plasmo-border plasmo-border-blue-200 plasmo-bg-blue-50 plasmo-rounded-lg plasmo-p-4">
            <h3 className="plasmo-font-semibold plasmo-mb-2 plasmo-text-blue-900">
              Uploading to Flow
            </h3>
            <p className="plasmo-text-sm plasmo-text-blue-700 plasmo-mb-3">
              {uploadState.currentFile}/{uploadState.totalFiles} files (
              {uploadState.percent}%)
            </p>
            <div className="plasmo-w-full plasmo-bg-blue-200 plasmo-rounded-full plasmo-h-2">
              <div
                className="plasmo-bg-blue-600 plasmo-h-2 plasmo-rounded-full plasmo-transition-all"
                style={{ width: `${uploadState.percent}%` }}></div>
            </div>
            <p className="plasmo-text-xs plasmo-text-blue-600 plasmo-mt-2 plasmo-truncate">
              {uploadState.url}
            </p>
          </div>
        )}

        {uploadUIState === "success" && uploadState && (
          <div className="plasmo-border plasmo-border-green-200 plasmo-bg-green-50 plasmo-rounded-lg plasmo-p-4">
            <p className="plasmo-text-sm plasmo-text-green-800 plasmo-font-medium">
              ✓ Uploaded {uploadState.totalFiles} pages to Flow
            </p>
          </div>
        )}

        {uploadUIState === "error" && uploadState?.error && (
          <div className="plasmo-border plasmo-border-red-200 plasmo-bg-red-50 plasmo-rounded-lg plasmo-p-4">
            <p className="plasmo-text-sm plasmo-text-red-800 plasmo-font-medium">
              ⚠ Upload Failed
            </p>
            <p className="plasmo-text-xs plasmo-text-red-600 plasmo-mt-1">
              {uploadState.error}
            </p>
          </div>
        )}

        {/* Capture Status (shown across all tabs when active) */}
        {status?.isCapturing && (
          <div className="plasmo-border plasmo-border-orange-200 plasmo-bg-orange-50 plasmo-rounded-lg plasmo-p-4">
            <h3 className="plasmo-font-semibold plasmo-mb-2 plasmo-text-orange-900">
              {isDocSendPage ? "Capturing DocSend" : "Capturing in background"}
            </h3>
            {status.totalPages && status.totalPages > 0 ? (
              <p className="plasmo-text-sm plasmo-text-orange-700">
                Page {status.currentPage} of {status.totalPages}
              </p>
            ) : (
              <p className="plasmo-text-sm plasmo-text-orange-700">
                Capturing page {status.currentPage}
              </p>
            )}
          </div>
        )}

        {/* Capture error (shown across all tabs) */}
        {status?.error && (
          <div className="plasmo-border plasmo-border-red-200 plasmo-bg-red-50 plasmo-rounded-lg plasmo-p-4">
            <p className="plasmo-text-sm plasmo-text-red-800 plasmo-font-medium">
              ⚠ Capture Error
            </p>
            <p className="plasmo-text-xs plasmo-text-red-600 plasmo-mt-1">
              {status.error}
            </p>
          </div>
        )}

        <div className="plasmo-border plasmo-border-border plasmo-rounded-lg plasmo-p-4 plasmo-bg-card">
          <h3 className="plasmo-font-semibold plasmo-mb-3 plasmo-text-foreground">
            DocSend Capture
          </h3>

          {!isDocSendPage ? (
            <div className="plasmo-bg-accent plasmo-border plasmo-border-border plasmo-rounded-lg plasmo-p-3">
              <p className="plasmo-text-sm plasmo-text-accent-foreground">
                Navigate to a DocSend presentation to start capture
              </p>
            </div>
          ) : status?.isCapturing ? (
            <button
              onClick={stopCapture}
              className="plasmo-w-full plasmo-bg-destructive plasmo-text-white plasmo-px-4 plasmo-py-2.5 plasmo-rounded-lg plasmo-font-medium plasmo-transition-opacity hover:plasmo-opacity-90">
              Stop Capture
            </button>
          ) : (
            <>
              <p className="plasmo-text-sm plasmo-text-muted-foreground plasmo-mb-4 plasmo-leading-relaxed">
                Click the button below to capture all slides from this DocSend
                presentation
              </p>
              <button
                onClick={startCapture}
                className="plasmo-w-full plasmo-bg-primary plasmo-text-primary-foreground plasmo-px-4 plasmo-py-2.5 plasmo-rounded-lg plasmo-font-medium plasmo-transition-opacity hover:plasmo-opacity-90">
                Start Capture
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default HomePage
