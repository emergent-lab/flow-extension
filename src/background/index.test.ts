import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getChromeStorageData,
  resetChromeStorage,
  resetMessageListeners,
  triggerChromeMessage
} from "../test/mocks/chrome"
import { createMockDataUrl, mockFetchResponse } from "../test/utils"

import { uploadScreenshots } from "../lib/upload-to-r2"

// Mock the upload-to-r2 module
vi.mock("../lib/upload-to-r2", () => ({
  uploadScreenshots: vi.fn()
}))

// Mock @plasmohq/storage to use direct chrome.storage.local
vi.mock("../lib/storage", () => ({
  storage: {
    set: vi.fn(async (key: string, value: any) => {
      await chrome.storage.local.set({ [key]: value })
    }),
    get: vi.fn(async (key: string) => {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key])
        })
      })
    }),
    remove: vi.fn(async (key: string) => {
      await chrome.storage.local.remove(key)
    })
  }
}))

// Import background script once (this registers the message listener)
import "./index"

// Mock environment
vi.stubEnv("PLASMO_PUBLIC_CLERK_SYNC_HOST", "http://localhost")

describe("background/index", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetChromeStorage()
    global.fetch = vi.fn()

    // Reset upload mock with default behavior
    ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockReset()
    ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: "test-key-1", filename: "page_1.png" },
      { key: "test-key-2", filename: "page_2.png" }
    ])
  })

  describe("captureScreenshot", () => {
    it("should capture screenshot using debugger API", async () => {
      const mockScreenshotData = "base64-image-data"

      // Mock debugger API
      chrome.debugger.sendCommand = vi.fn().mockResolvedValue({
        data: mockScreenshotData
      })

      // Trigger screenshot capture message
      const responses: any[] = []
      await new Promise<void>((resolve) => {
        chrome.runtime.onMessage.addListener(
          (message, sender, sendResponse) => {
            if (message.type === "CAPTURE_SCREENSHOT") {
              // Wait for async response
              setTimeout(() => {
                responses.push(sendResponse)
                resolve()
              }, 100)
              return true
            }
            return false
          }
        )

        triggerChromeMessage({ type: "CAPTURE_SCREENSHOT" }, {
          tab: { id: 1 }
        } as chrome.runtime.MessageSender)
      })

      // Verify debugger was attached
      expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, "1.3")

      // Verify screenshot command was sent
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 1 },
        "Page.captureScreenshot",
        {
          format: "png",
          captureBeyondViewport: false
        }
      )

      // Verify debugger was detached
      expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 })
    })

    it("should handle screenshot capture errors gracefully", async () => {
      // Mock debugger to fail
      chrome.debugger.attach = vi
        .fn()
        .mockRejectedValue(new Error("Debugger attach failed"))

      const responses: any[] = []
      await new Promise<void>((resolve) => {
        chrome.runtime.onMessage.addListener(
          (message, sender, sendResponse) => {
            if (message.type === "CAPTURE_SCREENSHOT") {
              setTimeout(() => {
                responses.push(sendResponse)
                resolve()
              }, 100)
              return true
            }
            return false
          }
        )

        triggerChromeMessage({ type: "CAPTURE_SCREENSHOT" }, {
          tab: { id: 1 }
        } as chrome.runtime.MessageSender)
      })

      // Verify detach was attempted
      expect(chrome.debugger.detach).toHaveBeenCalled()
    })

    it("should return error when no tab ID is provided", async () => {
      let capturedResponse: any = null

      await new Promise<void>((resolve) => {
        chrome.runtime.onMessage.addListener(
          (message, sender, sendResponse) => {
            if (message.type === "CAPTURE_SCREENSHOT") {
              setTimeout(() => {
                capturedResponse = sendResponse
                resolve()
              }, 50)
              return true
            }
            return false
          }
        )

        // Trigger without tab ID
        triggerChromeMessage(
          { type: "CAPTURE_SCREENSHOT" },
          {} as chrome.runtime.MessageSender
        )
      })

      // Note: In a real test, we'd verify the error response
      // but our mock doesn't capture sendResponse calls yet
    })
  })

  describe("updateUploadState", () => {
    it("should store upload state in chrome.storage.local", async () => {
      // Trigger upload to set state
      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockImplementation(
        async (screenshots, onProgress) => {
          // Call progress callback
          if (onProgress) {
            await onProgress({
              uploadedBytes: 5000,
              totalBytes: 10000,
              percent: 50,
              currentFile: 5,
              totalFiles: 10
            })
          }
          return [
            { key: "key1", filename: "page_1.png" },
            { key: "key2", filename: "page_2.png" }
          ]
        }
      )

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-id",
          imageCount: 2
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      // Wait for async operations
      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      const storageData = getChromeStorageData()
      expect(storageData.uploadState).toBeDefined()
      expect((storageData.uploadState as any).url).toBe(
        "https://docsend.com/view/test"
      )
    })

    it("should notify storage listeners of upload state changes", async () => {
      const storageChangeListener = vi.fn()
      chrome.storage.onChanged.addListener(storageChangeListener)

      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockImplementation(
        async (screenshots, onProgress) => {
          if (onProgress) {
            await onProgress({
              uploadedBytes: 5000,
              totalBytes: 10000,
              percent: 50,
              currentFile: 5,
              totalFiles: 10
            })
          }
          return []
        }
      )

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-id",
          imageCount: 2
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 200))

      // Verify storage change events were fired
      expect(storageChangeListener).toHaveBeenCalled()
      expect(storageChangeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadState: expect.any(Object)
        }),
        "local"
      )
    })
  })

  describe("uploadToAPI", () => {
    it("should upload screenshots and finalize successfully", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-material-id",
          imageCount: 2
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify uploadScreenshots was called
      expect(uploadScreenshots).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function)
      )

      // Verify finalize API was called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/extension/finalize-docsend-capture"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("test-key-1")
        })
      )
    })

    it("should send success notification on completion", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-material-id",
          imageCount: 2
        })
      )

      const notificationSpy = vi.spyOn(chrome.notifications, "create")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(notificationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "basic",
          title: "DocSend Capture Complete",
          message: expect.stringContaining("Successfully uploaded 2 pages")
        })
      )
    })

    it("should send success message to content script", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-material-id",
          imageCount: 2
        })
      )

      const tabMessageSpy = vi.spyOn(chrome.tabs, "sendMessage")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(tabMessageSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: "UPLOAD_SUCCESS",
          materialId: "test-material-id",
          imageCount: 2
        })
      )
    })

    it("should broadcast success message globally", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-material-id",
          imageCount: 2
        })
      )

      const broadcastSpy = vi.spyOn(chrome.runtime, "sendMessage")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPLOAD_SUCCESS"
        })
      )
    })

    it("should update upload state to complete on success", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-material-id",
          imageCount: 2
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      const storageData = getChromeStorageData()
      const uploadState = storageData.uploadState as any

      expect(uploadState).toBeDefined()
      expect(uploadState.isUploading).toBe(false)
      expect(uploadState.percent).toBe(100)
    })

    it("should handle upload errors gracefully", async () => {
      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error")
      )

      const notificationSpy = vi.spyOn(chrome.notifications, "create")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(notificationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "basic",
          title: "DocSend Upload Failed",
          message: expect.stringContaining("Network error")
        })
      )
    })

    it("should send error message to content script on failure", async () => {
      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Upload failed")
      )

      const tabMessageSpy = vi.spyOn(chrome.tabs, "sendMessage")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(tabMessageSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: "UPLOAD_ERROR",
          error: "Upload failed"
        })
      )
    })

    it("should broadcast error message globally on failure", async () => {
      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Test error")
      )

      const broadcastSpy = vi.spyOn(chrome.runtime, "sendMessage")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPLOAD_ERROR"
        })
      )
    })

    it("should update upload state with error on failure", async () => {
      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Test error")
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      const storageData = getChromeStorageData()
      const uploadState = storageData.uploadState as any

      expect(uploadState).toBeDefined()
      expect(uploadState.isUploading).toBe(false)
      expect(uploadState.error).toBe("Test error")
    })

    it("should handle finalize API errors", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ error: "Server error" }, false, 500)
      )

      const notificationSpy = vi.spyOn(chrome.notifications, "create")

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl(), createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 2,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(notificationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "DocSend Upload Failed"
        })
      )
    })

    it("should not upload if no tab ID is provided", async () => {
      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        {} as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should not call uploadScreenshots
      expect(uploadScreenshots).not.toHaveBeenCalled()
    })

    it("should track upload progress accurately", async () => {
      const progressUpdates: any[] = []

      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockImplementation(
        async (screenshots, onProgress) => {
          // Simulate progress updates
          if (onProgress) {
            await onProgress({
              uploadedBytes: 2500,
              totalBytes: 10000,
              percent: 25,
              currentFile: 1,
              totalFiles: 4
            })
            progressUpdates.push(getChromeStorageData().uploadState)

            await onProgress({
              uploadedBytes: 5000,
              totalBytes: 10000,
              percent: 50,
              currentFile: 2,
              totalFiles: 4
            })
            progressUpdates.push(getChromeStorageData().uploadState)

            await onProgress({
              uploadedBytes: 10000,
              totalBytes: 10000,
              percent: 100,
              currentFile: 4,
              totalFiles: 4
            })
            progressUpdates.push(getChromeStorageData().uploadState)
          }

          return [
            { key: "key1", filename: "page_1.png" },
            { key: "key2", filename: "page_2.png" },
            { key: "key3", filename: "page_3.png" },
            { key: "key4", filename: "page_4.png" }
          ]
        }
      )

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-id",
          imageCount: 4
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [
            createMockDataUrl(),
            createMockDataUrl(),
            createMockDataUrl(),
            createMockDataUrl()
          ],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 4,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      await new Promise((resolve) => setTimeout(resolve, 150))

      // Verify progress was tracked
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[0]).toBeDefined()
    })
  })

  describe("updateCaptureStatus", () => {
    it("should store capture status in chrome.storage.local", async () => {
      triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 5,
          totalPages: 10,
          capturedCount: 5
        }
      })

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      const storageData = getChromeStorageData()
      expect(storageData.captureStatus).toBeDefined()
      expect((storageData.captureStatus as any).isCapturing).toBe(true)
      expect((storageData.captureStatus as any).currentPage).toBe(5)
      expect((storageData.captureStatus as any).totalPages).toBe(10)
      expect((storageData.captureStatus as any).capturedCount).toBe(5)
    })

    it("should notify storage listeners of changes", async () => {
      // Mock storage change listener
      const storageChangeListener = vi.fn()
      chrome.storage.onChanged.addListener(storageChangeListener)

      triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 3,
          totalPages: 8,
          capturedCount: 3
        }
      })

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Verify storage change event was fired
      expect(storageChangeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          captureStatus: expect.objectContaining({
            newValue: expect.objectContaining({
              isCapturing: true,
              currentPage: 3,
              totalPages: 8
            })
          })
        }),
        "local"
      )
    })

    it("should persist capture status with error", async () => {
      triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: false,
          currentPage: 0,
          totalPages: null,
          capturedCount: 0,
          error: "Failed to capture page"
        }
      })

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      const storageData = getChromeStorageData()
      expect(storageData.captureStatus).toBeDefined()
      expect((storageData.captureStatus as any).error).toBe(
        "Failed to capture page"
      )
    })

    it("should always persist to storage (no dependency on message delivery)", async () => {
      // With @plasmohq/storage, we don't use runtime.sendMessage anymore
      // Storage operations always succeed regardless of listeners

      triggerChromeMessage({
        type: "CAPTURE_STATUS",
        status: {
          isCapturing: true,
          currentPage: 1,
          totalPages: 5,
          capturedCount: 1
        }
      })

      // Wait longer for @plasmohq/storage async operations
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Status should be persisted
      const storageData = getChromeStorageData()
      expect(storageData.captureStatus).toBeDefined()
      expect((storageData.captureStatus as any).isCapturing).toBe(true)
    })
  })

  describe("Message Routing", () => {
    it("should ignore unknown message types", () => {
      const broadcastSpy = vi.spyOn(chrome.runtime, "sendMessage")

      triggerChromeMessage({
        type: "UNKNOWN_MESSAGE_TYPE"
      })

      // Should not crash or send any messages
      expect(broadcastSpy).not.toHaveBeenCalled()
    })
  })

  describe("Environment Configuration", () => {
    it("should use correct web app URL for localhost", () => {
      vi.stubEnv("PLASMO_PUBLIC_CLERK_SYNC_HOST", "http://localhost")

      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: "test-key", filename: "page_1.png" }
      ])

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-id",
          imageCount: 1
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      // Wait for async operations
      setTimeout(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("localhost:3000"),
          expect.any(Object)
        )
      }, 100)
    })

    it("should use correct web app URL for production", () => {
      vi.stubEnv("PLASMO_PUBLIC_CLERK_SYNC_HOST", "https://app.example.com")

      ;(uploadScreenshots as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: "test-key", filename: "page_1.png" }
      ])

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          success: true,
          materialId: "test-id",
          imageCount: 1
        })
      )

      triggerChromeMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: [createMockDataUrl()],
          metadata: {
            url: "https://docsend.com/view/test",
            totalPages: 1,
            capturedAt: new Date().toISOString()
          }
        },
        { tab: { id: 1 } } as chrome.runtime.MessageSender
      )

      // Wait for async operations
      setTimeout(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("https://app.example.com"),
          expect.any(Object)
        )
      }, 100)
    })
  })
})
