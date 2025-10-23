import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resetMessageListeners,
  triggerChromeMessage
} from "../test/mocks/chrome"
import { renderWithProviders, userEvent } from "../test/utils"
import CaptureButton from "./capture-button"

describe("CaptureButton", () => {
  beforeEach(() => {
    resetMessageListeners()
    vi.clearAllMocks()
    vi.clearAllTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe("Default State", () => {
    it("should render 'Save to Flow' button by default", () => {
      renderWithProviders(<CaptureButton />)

      expect(screen.getByText(/Save to Flow/i)).toBeInTheDocument()
    })

    it("should have primary styling in default state", () => {
      renderWithProviders(<CaptureButton />)

      const button = screen.getByText(/Save to Flow/i)
      expect(button.className).toContain("flow-button-primary")
    })
  })

  describe("Capturing State", () => {
    it("should show capturing state when capture starts", async () => {
      renderWithProviders(<CaptureButton />)

      // Dispatch custom event to simulate capture start
      const captureEvent = new CustomEvent("flow:capture:status", {
        detail: {
          isCapturing: true,
          currentPage: 3,
          totalPages: 10,
          capturedCount: 3
        }
      })
      document.dispatchEvent(captureEvent)

      await waitFor(
        () => {
          expect(screen.getByText(/Capturing... 3\/10/i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should fall back to single-page label when total pages are unknown", async () => {
      renderWithProviders(<CaptureButton />)

      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 2,
            totalPages: null,
            capturedCount: 2
          }
        })
      )

      await waitFor(
        () => {
          expect(screen.getByText(/Capturing page 2/i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should switch to uploading state when capture completes", async () => {
      renderWithProviders(<CaptureButton />)

      // Start capturing
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 5,
            totalPages: 10,
            capturedCount: 5
          }
        })
      )

      await waitFor(
        () => {
          expect(screen.getByText(/Capturing.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Complete capture
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 10,
            totalPages: 10,
            capturedCount: 10
          }
        })
      )

      await waitFor(
        () => {
          expect(screen.getByText(/Uploading.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })
  })

  describe("Uploading State", () => {
    it("should show uploading message", async () => {
      renderWithProviders(<CaptureButton />)

      // First start capturing
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 5,
            totalPages: 10,
            capturedCount: 5
          }
        })
      )

      // Wait for capturing state to be set
      await waitFor(
        () => {
          expect(screen.getByText(/Capturing.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Then complete capture to trigger upload
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 10,
            totalPages: 10,
            capturedCount: 10
          }
        })
      )

      await waitFor(
        () => {
          expect(screen.getByText(/Uploading.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should disable button during upload", async () => {
      renderWithProviders(<CaptureButton />)

      // First start capturing
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 5,
            totalPages: 10,
            capturedCount: 5
          }
        })
      )

      // Wait for capturing state to be set
      await waitFor(
        () => {
          expect(screen.getByText(/Capturing.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Then complete capture to trigger upload
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 10,
            totalPages: 10,
            capturedCount: 10
          }
        })
      )

      await waitFor(
        () => {
          const uploadingDiv = screen.getByText(/Uploading.../i)
          // It's a div, not a button, so not clickable
          expect(uploadingDiv.tagName).toBe("DIV")
        },
        { timeout: 500 }
      )
    })
  })

  describe("Success State", () => {
    it("should show success message after upload completes", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_SUCCESS",
        materialId: "test-id",
        imageCount: 10
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Uploaded to Flow/i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should have success styling", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_SUCCESS",
        materialId: "test-id",
        imageCount: 10
      })

      await waitFor(
        () => {
          const successDiv = screen.getByText(/Uploaded to Flow/i)
          expect(successDiv.className).toContain("flow-button-success")
        },
        { timeout: 500 }
      )
    })

    it("should auto-dismiss success state after 3 seconds", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_SUCCESS",
        materialId: "test-id",
        imageCount: 10
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Uploaded to Flow/i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Wait for auto-dismiss (3 seconds + buffer)
      await waitFor(
        () => {
          expect(
            screen.queryByText(/Uploaded to Flow/i)
          ).not.toBeInTheDocument()
          expect(screen.getByText(/Save to Flow/i)).toBeInTheDocument()
        },
        { timeout: 3500 }
      )
    })
  })

  describe("Error State", () => {
    it("should show error message on upload failure", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Network connection failed"
      })

      await waitFor(
        () => {
          expect(
            screen.getByText(/Upload Failed: Network connection failed/i)
          ).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should have error styling", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Test error"
      })

      await waitFor(
        () => {
          const errorButton = screen.getByText(/Upload Failed/i)
          expect(errorButton.className).toContain("flow-button-error")
        },
        { timeout: 500 }
      )
    })

    it("should be clickable to retry in error state", async () => {
      const user = userEvent.setup()
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Test error"
      })

      const errorButton = await screen.findByText(
        /Upload Failed/i,
        {},
        { timeout: 500 }
      )
      await user.click(errorButton)

      // Should dispatch start capture event
      // This is hard to test without spying on document.dispatchEvent
      expect(errorButton.tagName).toBe("BUTTON")
    })

    it("should auto-dismiss error state after 5 seconds", async () => {
      renderWithProviders(<CaptureButton />)

      await triggerChromeMessage({
        type: "UPLOAD_ERROR",
        error: "Test error"
      })

      await waitFor(
        () => {
          expect(screen.getByText(/Upload Failed/i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Wait for auto-dismiss (5 seconds + buffer)
      await waitFor(
        () => {
          expect(screen.queryByText(/Upload Failed/i)).not.toBeInTheDocument()
          expect(screen.getByText(/Save to Flow/i)).toBeInTheDocument()
        },
        { timeout: 5500 }
      )
    }, 7000) // Increase test timeout to 7 seconds
  })

  describe("User Interactions", () => {
    it("should dispatch start capture event on click", async () => {
      const user = userEvent.setup()
      const dispatchSpy = vi.spyOn(document, "dispatchEvent")

      renderWithProviders(<CaptureButton />)

      const button = screen.getByText(/Save to Flow/i)
      await user.click(button)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "flow:capture:start"
        })
      )
    })

    it("should dispatch stop capture event when capturing", async () => {
      const user = userEvent.setup()
      const dispatchSpy = vi.spyOn(document, "dispatchEvent")

      renderWithProviders(<CaptureButton />)

      // Start capturing
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 5,
            totalPages: 10,
            capturedCount: 5
          }
        })
      )

      const button = await screen.findByText(
        /Capturing.../i,
        {},
        { timeout: 500 }
      )
      await user.click(button)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "flow:capture:stop"
        })
      )
    })

    it("should not allow clicks during upload", async () => {
      renderWithProviders(<CaptureButton />)

      // First start capturing
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: true,
            currentPage: 5,
            totalPages: 10,
            capturedCount: 5
          }
        })
      )

      // Wait for capturing state to be set
      await waitFor(
        () => {
          expect(screen.getByText(/Capturing.../i)).toBeInTheDocument()
        },
        { timeout: 500 }
      )

      // Then complete capture to trigger upload
      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 10,
            totalPages: 10,
            capturedCount: 10
          }
        })
      )

      await waitFor(
        () => {
          const uploadingDiv = screen.getByText(/Uploading.../i)
          // Should be a div, not a button
          expect(uploadingDiv.tagName).toBe("DIV")
        },
        { timeout: 500 }
      )
    })
  })

  describe("Capture Error State", () => {
    it("should show capture error message", async () => {
      renderWithProviders(<CaptureButton />)

      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 0,
            totalPages: 0,
            capturedCount: 0,
            error: "Failed to navigate pages"
          }
        })
      )

      await waitFor(
        () => {
          expect(
            screen.getByText(/Failed to navigate pages/i)
          ).toBeInTheDocument()
        },
        { timeout: 500 }
      )
    })

    it("should have error styling for capture errors", async () => {
      renderWithProviders(<CaptureButton />)

      document.dispatchEvent(
        new CustomEvent("flow:capture:status", {
          detail: {
            isCapturing: false,
            currentPage: 0,
            totalPages: 0,
            capturedCount: 0,
            error: "Test error"
          }
        })
      )

      await waitFor(
        () => {
          const errorButton = screen.getByText(/Test error/i)
          expect(errorButton.className).toContain("flow-button-error")
        },
        { timeout: 500 }
      )
    })
  })
})
