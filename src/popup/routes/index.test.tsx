import { useUser } from "@clerk/chrome-extension"
import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resetChromeStorage,
  resetMessageListeners,
  setChromeStorageData,
  setupChromeMocks,
  triggerChromeMessage
} from "../../test/mocks/chrome"
import { renderWithProviders, userEvent } from "../../test/utils"
import HomePage from "./index"

// Mock Clerk - must be before imports that use it
vi.mock("@clerk/chrome-extension", () => ({
  useUser: vi.fn(() => ({
    isSignedIn: true,
    isLoaded: true,
    user: { firstName: "Test" }
  }))
}))

describe("HomePage", () => {
  beforeEach(() => {
    setupChromeMocks() // Reset Chrome mocks to defaults
    resetChromeStorage()
    resetMessageListeners()
    vi.clearAllMocks()
    vi.clearAllTimers()

    // Reset useUser mock to default
    ;(useUser as ReturnType<typeof vi.fn>).mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      user: { firstName: "Test" }
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  // Helper to wait for component to be fully rendered
  const waitForComponentReady = async () => {
    await waitFor(
      () => {
        const welcomeText = screen.queryByText(/Welcome back/i)
        const docSendSection = screen.queryByText(/DocSend Capture/i)
        expect(welcomeText || docSendSection).toBeTruthy()
      },
      { timeout: 1000 }
    )
  }

  describe("Upload State Display", () => {
    it("should load upload state from storage on mount", async () => {
      setChromeStorageData({
        uploadState: {
          isUploading: true,
          currentFile: 5,
          totalFiles: 10,
          percent: 50,
          url: "https://docsend.com/view/test"
        }
      })

      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await waitFor(
        () => {
          expect(screen.getByText(/Uploading to Flow/i)).toBeInTheDocument()
          expect(screen.getByText(/5\/10 files \(50%\)/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should display upload progress when uploading", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      // Trigger upload state change message
      await triggerChromeMessage({
        type: "UPLOAD_STATE_CHANGED",
        state: {
          isUploading: true,
          currentFile: 3,
          totalFiles: 10,
          percent: 30,
          url: "https://docsend.com/view/test"
        }
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Uploading to Flow/i)).toBeInTheDocument()
          expect(screen.getByText(/3\/10 files \(30%\)/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show success message after upload completes", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "UPLOAD_SUCCESS",
        materialId: "test-material-id",
        imageCount: 10
      })

      await waitFor(
        () => {
          expect(
            screen.getByText(/Uploaded 10 pages to Flow/i)
          ).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show error message on upload failure", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Network error"
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Upload Failed/i)).toBeInTheDocument()
          expect(screen.getByText(/Network error/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should auto-dismiss success message after 3 seconds", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "UPLOAD_SUCCESS",
        materialId: "test-material-id",
        imageCount: 10
      })

      await waitFor(
        () => {
          expect(
            screen.getByText(/Uploaded 10 pages to Flow/i)
          ).toBeInTheDocument()
        },
        { timeout: 1000 }
      )

      // Wait for auto-dismiss (3 seconds + buffer)
      await waitFor(
        () => {
          expect(
            screen.queryByText(/Uploaded 10 pages to Flow/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 3500 }
      )
    })

    it("should auto-dismiss error message after 5 seconds", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Test error"
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Upload Failed/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )

      // Wait for auto-dismiss (5 seconds + buffer)
      await waitFor(
        () => {
          expect(screen.queryByText(/Upload Failed/i)).not.toBeInTheDocument()
        },
        { timeout: 5500 }
      )
    }, 7000) // Increase test timeout to 7 seconds
  })

  describe("Capture Controls", () => {
    it("should show DocSend capture section when signed in", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      expect(screen.getByText(/DocSend Capture/i)).toBeInTheDocument()
    })

    it("should display message when not on DocSend page", async () => {
      // Mock tabs.query to return non-DocSend page
      vi.spyOn(chrome.tabs, "query").mockImplementation(((
        queryInfo: chrome.tabs.QueryInfo,
        callback?: (result: chrome.tabs.Tab[]) => void
      ) => {
        const tabs = [
          {
            id: 1,
            url: "https://google.com",
            active: true,
            windowId: 1
          }
        ] as chrome.tabs.Tab[]

        if (callback) {
          callback(tabs)
          return
        }

        return Promise.resolve(tabs)
      }) as typeof chrome.tabs.query)

      renderWithProviders(<HomePage />)

      await waitFor(
        () => {
          expect(
            screen.getByText(
              /Navigate to a DocSend presentation to enable capture/i
            )
          ).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show start capture button on DocSend page", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await waitFor(
        () => {
          expect(screen.getByText(/Start Capture/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should handle start capture button click", async () => {
      const user = userEvent.setup()
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      const startButton = await screen.findByText(
        /Start Capture/i,
        {},
        { timeout: 1000 }
      )
      await user.click(startButton)

      // Verify message was sent to content script
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: "START_CAPTURE"
      })
    })

    it("should show capturing status during capture", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 5,
          totalPages: 10,
          capturedCount: 5
        }
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Capturing in progress/i)).toBeInTheDocument()
          expect(screen.getByText(/Page 5 of 10/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show stop capture button during capture", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 3,
          totalPages: 10,
          capturedCount: 3
        }
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Stop Capture/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should handle stop capture button click", async () => {
      const user = userEvent.setup()
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      // Start capturing first
      await triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 3,
          totalPages: 10,
          capturedCount: 3
        }
      })

      const stopButton = await screen.findByText(
        /Stop Capture/i,
        {},
        { timeout: 1000 }
      )
      await user.click(stopButton)

      // Verify message was sent to content script
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: "STOP_CAPTURE"
      })
    })

    it("should show error state when capture fails", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: false,
          currentPage: 0,
          totalPages: 0,
          capturedCount: 0,
          error: "Failed to capture page"
        }
      })

      await waitFor(
        () => {
          expect(
            screen.getByText(/Failed to capture page/i)
          ).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should handle captures when total page count is unknown", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 2,
          totalPages: null,
          capturedCount: 1
        }
      })

      await waitFor(
        () => {
          expect(screen.queryByText(/of null/i)).toBeNull()
        },
        { timeout: 1000 }
      )
    })
  })

  describe("User Authentication", () => {
    it("should show welcome message with user name", async () => {
      renderWithProviders(<HomePage />)

      await waitFor(
        () => {
          expect(screen.getByText(/Welcome back, Test!/i)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show loading state while checking auth", async () => {
      // Mock loading state
      ;(useUser as ReturnType<typeof vi.fn>).mockReturnValue({
        isSignedIn: false,
        isLoaded: false,
        user: null
      })

      renderWithProviders(<HomePage />)

      // Should show spinner
      await waitFor(
        () => {
          const loadingElement = document.querySelector(".plasmo-animate-spin")
          expect(loadingElement).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })
  })

  describe("Upload Progress Bar", () => {
    it("should render progress bar with correct width", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      await triggerChromeMessage({
        type: "UPLOAD_STATE_CHANGED",
        state: {
          isUploading: true,
          currentFile: 7,
          totalFiles: 10,
          percent: 70,
          url: "https://docsend.com/view/test"
        }
      })

      await waitFor(
        () => {
          const progressBar = document.querySelector('[style*="width: 70%"]')
          expect(progressBar).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })

    it("should show URL in upload status", async () => {
      renderWithProviders(<HomePage />)
      await waitForComponentReady()

      const testUrl = "https://docsend.com/view/abc123"

      await triggerChromeMessage({
        type: "UPLOAD_STATE_CHANGED",
        state: {
          isUploading: true,
          currentFile: 5,
          totalFiles: 10,
          percent: 50,
          url: testUrl
        }
      })

      await waitFor(
        () => {
          expect(screen.getByText(testUrl)).toBeInTheDocument()
        },
        { timeout: 1000 }
      )
    })
  })
})
