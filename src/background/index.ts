import { uploadScreenshots } from "../lib/upload-to-r2"
import { storage } from "../lib/storage"
import { getAuthHeaders } from "../lib/clerk-auth"

interface CaptureScreenshotMessage {
  type: "CAPTURE_SCREENSHOT"
}

interface UploadScreenshotsMessage {
  type: "UPLOAD_SCREENSHOTS"
  screenshots: string[]
  metadata: {
    url: string
    totalPages: number
    capturedAt: string
  }
}

interface CaptureStatusMessage {
  type: "CAPTURE_STATUS"
  status: {
    isCapturing: boolean
    currentPage: number
    totalPages: number | null
    error?: string
  }
}

interface ClearStatesMessage {
  type: "CLEAR_STATES"
}

interface EnsureCaptureZoomMessage {
  type: "ENSURE_CAPTURE_ZOOM"
}

interface RestoreCaptureZoomMessage {
  type: "RESTORE_CAPTURE_ZOOM"
}

type Message =
  | CaptureScreenshotMessage
  | UploadScreenshotsMessage
  | CaptureStatusMessage
  | ClearStatesMessage
  | EnsureCaptureZoomMessage
  | RestoreCaptureZoomMessage

const tabZoomState = new Map<number, number>()

// Handle screenshot capture using Chrome DevTools Protocol
async function captureScreenshot(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: { screenshot?: string; error?: string }) => void
) {
  const tabId = sender.tab?.id

  if (!tabId) {
    sendResponse({ error: "No tab found" })
    return
  }

  let tabDetails: chrome.tabs.Tab | undefined
  try {
    tabDetails = await chrome.tabs.get(tabId)
  } catch (tabInfoError) {
    console.warn(
      "[Background] Failed to read tab information before capture:",
      tabInfoError
    )
  }

  console.log("[Background] captureScreenshot request", {
    tabId,
    senderUrl: sender.url,
    senderOrigin: sender.origin,
    tabUrl: tabDetails?.url,
    pendingUrl: tabDetails?.pendingUrl,
    status: tabDetails?.status,
    discarded: tabDetails?.discarded ?? null
  })

  try {
    // Attach debugger to the tab
    await chrome.debugger.attach({ tabId }, "1.3")

    // Capture screenshot using Chrome DevTools Protocol
    const result = (await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: false
      }
    )) as { data: string }

    // Detach debugger
    await chrome.debugger.detach({ tabId })

    console.log("[Background] captureScreenshot success", {
      tabId,
      bytes: result.data.length,
      tabUrl: tabDetails?.url,
      pendingUrl: tabDetails?.pendingUrl
    })

    // Convert base64 to data URL
    const screenshot = `data:image/png;base64,${result.data}`

    sendResponse({ screenshot })
  } catch (error) {
    console.error("Screenshot capture error:", error)
    if (tabDetails) {
      console.error("[Background] captureScreenshot tab state on error:", {
        tabId,
        tabUrl: tabDetails.url,
        pendingUrl: tabDetails.pendingUrl,
        status: tabDetails.status
      })
    }

    // Try to detach if still attached
    try {
      await chrome.debugger.detach({ tabId })
    } catch (_e) {
      // Ignore detach errors
    }

    sendResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    })
  }
}

// Upload state interface for chrome.storage
interface UploadState {
  isUploading: boolean
  currentFile: number
  totalFiles: number
  percent: number
  url: string
  error?: string
}

// Capture status interface for chrome.storage
interface CaptureStatus {
  isCapturing: boolean
  currentPage: number
  totalPages: number | null
  capturedCount: number
  error?: string
}

// Helper function to get web app URL
function getWebAppUrl(path: string = ""): string {
  const frontendUrl =
    process.env.PLASMO_PUBLIC_FRONTEND_URL || "http://localhost:3000"
  return `${frontendUrl}${path}`
}

// Helper to update upload state in storage
// Using @plasmohq/storage for automatic sync across all extension contexts
async function updateUploadState(state: UploadState) {
  await storage.set("uploadState", state)
}

// Upload screenshots directly to R2 and finalize
async function uploadToAPI(
  message: UploadScreenshotsMessage,
  sender: chrome.runtime.MessageSender
) {
  console.log(
    `[Background] uploadToAPI called with ${message.screenshots.length} screenshots`
  )
  console.log(`[Background] Metadata:`, message.metadata)

  const tabId = sender.tab?.id
  if (!tabId) {
    console.error("[Background] No tab ID found in sender")
    return
  }

  // Initialize upload state
  await updateUploadState({
    isUploading: true,
    currentFile: 0,
    totalFiles: message.screenshots.length,
    percent: 0,
    url: message.metadata.url
  })

  try {
    // Step 1: Upload screenshots directly to R2 using presigned URLs
    console.log(`[Background] Uploading screenshots directly to R2...`)

    const uploadResults = await uploadScreenshots(
      message.screenshots,
      async (progress) => {
        console.log(
          `[Background] Upload progress: ${progress.currentFile}/${progress.totalFiles} files, ${progress.percent}%`
        )

        // Update storage and broadcast progress
        await updateUploadState({
          isUploading: true,
          currentFile: progress.currentFile,
          totalFiles: progress.totalFiles,
          percent: progress.percent,
          url: message.metadata.url
        })

        // Send progress updates to content script in the specific tab
        chrome.tabs
          .sendMessage(tabId, {
            type: "UPLOAD_PROGRESS",
            progress
          })
          .catch((err) => {
            console.warn("[Background] Failed to send progress update:", err)
          })
      }
    )

    const imageKeys = uploadResults.map((r) => r.key)
    const originalFileNames = uploadResults.map((r) => r.filename)

    console.log(`[Background] All screenshots uploaded to R2:`, imageKeys)

    // Step 2: Finalize by creating the material
    console.log(`[Background] Finalizing material creation...`)

    const finalizeUrl = getWebAppUrl("/api/extension/finalize-docsend-capture")
    const authHeaders = await getAuthHeaders()
    const finalizeResponse = await fetch(finalizeUrl, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageKeys,
        originalFileNames,
        metadata: message.metadata
      })
    })

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json()
      throw new Error(error.error || "Failed to finalize capture")
    }

    const result = await finalizeResponse.json()
    console.log(`[Background] Finalization successful:`, result)

    // Clear upload state - success
    await updateUploadState({
      isUploading: false,
      currentFile: message.screenshots.length,
      totalFiles: message.screenshots.length,
      percent: 100,
      url: message.metadata.url
    })

    // Show success notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png") || "",
      title: "DocSend Capture Complete",
      message: `Successfully uploaded ${message.metadata.totalPages} pages to Flow`
    })

    // Send success message to content script in the specific tab
    chrome.tabs
      .sendMessage(tabId, {
        type: "UPLOAD_SUCCESS",
        materialId: result.materialId,
        imageCount: result.imageCount
      })
      .catch((err) => {
        console.warn("[Background] Failed to send success message:", err)
      })

    // Broadcast success globally
    chrome.runtime
      .sendMessage({
        type: "UPLOAD_SUCCESS",
        materialId: result.materialId,
        imageCount: result.imageCount
      })
      .catch(() => {
        // Ignore if no receivers
      })
  } catch (error) {
    console.error("[Background] Upload error:", error)

    const errorMessage =
      error instanceof Error ? error.message : "Failed to upload captures"

    // Update state with error
    await updateUploadState({
      isUploading: false,
      currentFile: 0,
      totalFiles: message.screenshots.length,
      percent: 0,
      url: message.metadata.url,
      error: errorMessage
    })

    // Show error notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png") || "",
      title: "DocSend Upload Failed",
      message: errorMessage
    })

    // Send error message to content script in the specific tab
    chrome.tabs
      .sendMessage(tabId, {
        type: "UPLOAD_ERROR",
        error: errorMessage
      })
      .catch((err) => {
        console.warn("[Background] Failed to send error message:", err)
      })

    // Broadcast error globally
    chrome.runtime
      .sendMessage({
        type: "UPLOAD_ERROR",
        error: errorMessage
      })
      .catch(() => {
        // Ignore if no receivers
      })
  }
}

// Message listener
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    console.log(`[Background] Received message:`, message.type)

    if (message.type === "CAPTURE_SCREENSHOT") {
      captureScreenshot(sender, sendResponse)
      return true // Keep channel open for async response
    }

    if (message.type === "UPLOAD_SCREENSHOTS") {
      console.log(`[Background] UPLOAD_SCREENSHOTS message received`)
      uploadToAPI(message as UploadScreenshotsMessage, sender)
      return false // No response needed
    }

    if (message.type === "ENSURE_CAPTURE_ZOOM") {
      const tabId = sender.tab?.id

      if (!tabId) {
        sendResponse({
          success: false,
          adjusted: false,
          error: "No tab ID provided for zoom adjustment"
        })
        return false
      }

      ;(async () => {
        try {
          const currentZoom = await chrome.tabs.getZoom(tabId)
          const storedOriginalZoom = tabZoomState.get(tabId)
          const originalZoom = storedOriginalZoom ?? currentZoom

          console.log("[Background] ENSURE_CAPTURE_ZOOM", {
            tabId,
            currentZoom,
            storedOriginalZoom
          })

          if (Math.abs(currentZoom - 1) <= 0.01) {
            sendResponse({
              success: true,
              adjusted: false,
              currentZoom
            })
            return
          }

          if (!tabZoomState.has(tabId)) {
            tabZoomState.set(tabId, originalZoom)
          }

          await chrome.tabs.setZoom(tabId, 1)

          sendResponse({
            success: true,
            adjusted: true,
            currentZoom: 1,
            previousZoom: originalZoom
          })
        } catch (error) {
          console.error("[Background] Failed to ensure capture zoom:", error)
          sendResponse({
            success: false,
            adjusted: false,
            error: error instanceof Error ? error.message : "Failed to adjust zoom"
          })
        }
      })()

      return true
    }

    if (message.type === "RESTORE_CAPTURE_ZOOM") {
      const tabId = sender.tab?.id

      if (!tabId) {
        sendResponse({
          success: false,
          error: "No tab ID provided for zoom restore"
        })
        return false
      }

      const originalZoom = tabZoomState.get(tabId)

      if (originalZoom === undefined) {
        sendResponse({
          success: true,
          restored: false
        })
        return false
      }

      ;(async () => {
        try {
          await chrome.tabs.setZoom(tabId, originalZoom)
          sendResponse({
            success: true,
            restored: true,
            zoom: originalZoom
          })
        } catch (error) {
          console.error("[Background] Failed to restore capture zoom:", error)
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "Failed to restore zoom"
          })
        } finally {
          tabZoomState.delete(tabId)
        }
      })()

      return true
    }

    if (message.type === "CAPTURE_STATUS") {
      // Persist capture status - @plasmohq/storage automatically syncs to all extension contexts
      // Note: Fire-and-forget pattern is OK here - we don't need to await
      console.log("[Background] CAPTURE_STATUS update", message.status)
      void storage.set("captureStatus", message.status)
      return false
    }

    if (message.type === "CLEAR_STATES") {
      // Clear both upload and capture states from storage
      console.log("[Background] CLEAR_STATES message received. Clearing storage.")
      void storage.remove("uploadState")
      void storage.remove("captureStatus")
      return false
    }

    return false
  }
)

// Listen for messages from the web app (external)
chrome.runtime.onMessageExternal.addListener(
  (
    message: { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: { installed: boolean; version?: string }) => void
  ) => {
    console.log(`[Background] External message from:`, sender.url)

    // Respond to ping from web app
    if (message.type === "PING_EXTENSION") {
      sendResponse({
        installed: true,
        version: chrome.runtime.getManifest().version
      })
      return true
    }

    return false
  }
)

console.log("Flow background script loaded")
