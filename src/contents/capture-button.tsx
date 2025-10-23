import type {
  PlasmoCSConfig,
  PlasmoGetInlineAnchor,
  PlasmoGetStyle
} from "plasmo"
import { useEffect, useState } from "react"

import "../style.css"

export const config: PlasmoCSConfig = {
  matches: ["https://docsend.com/*"]
}

// Mount button inside DocSend toolbar
export const getInlineAnchor: PlasmoGetInlineAnchor = () => {
  const toolbarButtons = document.querySelector(
    ".presentation-toolbar_buttons.pull-right"
  )
  if (toolbarButtons) {
    return {
      element: toolbarButtons as HTMLElement,
      insertPosition: "afterbegin"
    }
  }
  // Fallback if toolbar not found
  return {
    element: document.body,
    insertPosition: "afterbegin"
  }
}

// Inject styles into shadow DOM
export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = `
    @import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap");

    .flow-button {
      display: inline-block;
      vertical-align: middle;
      margin-right: 0.75rem;
      padding: 0.5rem 0.875rem;
      border-radius: 0.375rem;
      font-family: 'Geist', system-ui, sans-serif;
      font-weight: 500;
      font-size: 0.8125rem;
      line-height: 1.25rem;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.3);
      transition: opacity 0.2s, box-shadow 0.2s;
      cursor: pointer;
      border: none;
      white-space: nowrap;
    }

    .flow-button:hover {
      opacity: 0.9;
      box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.4);
    }

    .flow-button-primary {
      background: oklch(0.922 0 0);
      color: oklch(0.205 0 0);
    }

    .flow-button-success {
      background: #16a34a;
      color: white;
    }

    .flow-button-error {
      background: oklch(0.704 0.191 22.216);
      color: white;
    }

    @media (max-width: 767px) {
      .flow-button {
        margin-right: 0.5rem;
        padding: 0.375rem 0.625rem;
        font-size: 0.75rem;
      }
    }
  `
  return style
}

interface CaptureStatus {
  isCapturing: boolean
  currentPage: number
  totalPages: number | null
  capturedCount: number
  error?: string
}

type UploadState = "idle" | "uploading" | "success" | "error"

const CaptureButton = () => {
  const [status, setStatus] = useState<CaptureStatus>({
    isCapturing: false,
    currentPage: 0,
    totalPages: null,
    capturedCount: 0
  })
  const [uploadState, setUploadState] = useState<UploadState>("idle")
  const [uploadError, setUploadError] = useState<string>("")

  // Listen for status updates from content.ts
  useEffect(() => {
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<CaptureStatus>
      const newStatus = customEvent.detail

      // Check if capture just completed successfully - start uploading
      if (
        status.isCapturing &&
        !newStatus.isCapturing &&
        !newStatus.error &&
        newStatus.capturedCount > 0
      ) {
        setUploadState("uploading")
      }

      setStatus(newStatus)
    }

    document.addEventListener("flow:capture:status", listener)
    return () => document.removeEventListener("flow:capture:status", listener)
  }, [status.isCapturing])

  // Listen for upload success/error from background script
  useEffect(() => {
    const listener = (
      message: {
        type: string
        materialId?: string
        imageCount?: number
        error?: string
      },
      _sender: chrome.runtime.MessageSender
    ) => {
      if (message.type === "UPLOAD_SUCCESS") {
        setUploadState("success")
        setTimeout(() => {
          setUploadState("idle")
        }, 3000)
      } else if (message.type === "UPLOAD_ERROR") {
        setUploadState("error")
        setUploadError(message.error || "Upload failed")
        setTimeout(() => {
          setUploadState("idle")
          setUploadError("")
        }, 5000)
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleClick = () => {
    // Don't allow clicks while uploading
    if (uploadState === "uploading") return

    const eventType = status.isCapturing
      ? "flow:capture:stop"
      : "flow:capture:start"
    document.dispatchEvent(new CustomEvent(eventType))
  }

  // Upload success state
  if (uploadState === "success") {
    return (
      <div className="flow-button flow-button-success">✓ Uploaded to Flow</div>
    )
  }

  // Upload error state
  if (uploadState === "error") {
    return (
      <button onClick={handleClick} className="flow-button flow-button-error">
        ⚠ Upload Failed: {uploadError}
      </button>
    )
  }

  // Uploading state
  if (uploadState === "uploading") {
    return <div className="flow-button flow-button-primary">Uploading...</div>
  }

  // Capture error state
  if (status.error) {
    return (
      <button onClick={handleClick} className="flow-button flow-button-error">
        ⚠ {status.error}
      </button>
    )
  }

  // Default or capturing state
  const capturingLabel = (() => {
    const currentPageDisplay = status.currentPage > 0 ? status.currentPage : 1
    if (status.totalPages && status.totalPages > 0) {
      return `Capturing... ${currentPageDisplay}/${status.totalPages}`
    }
    return `Capturing page ${currentPageDisplay}`
  })()

  return (
    <button onClick={handleClick} className="flow-button flow-button-primary">
      {status.isCapturing ? capturingLabel : "Save to Flow"}
    </button>
  )
}

export default CaptureButton
