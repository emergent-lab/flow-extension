import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://docsend.com/*"],
  run_at: "document_end"
}

interface CaptureState {
  isCapturing: boolean
  currentPage: number
  totalPages: number | null
  screenshots: string[]
  capturedCount: number
  error?: string
  zoomAdjusted: boolean
}

const captureState: CaptureState = {
  isCapturing: false,
  currentPage: 0,
  totalPages: null,
  screenshots: [],
  capturedCount: 0,
  error: undefined,
  zoomAdjusted: false
}

function logCaptureContext(
  message: string,
  extra: Record<string, unknown> = {}
) {
  console.log(`[Content] ${message}`, {
    url: window.location.href,
    visibility: document.visibilityState,
    readyState: document.readyState,
    currentPage: captureState.currentPage,
    totalPages: captureState.totalPages,
    isCapturing: captureState.isCapturing,
    ...extra
  })
}

// Check if this is a scrollable document (vs presentation with slides)
function isScrollableDocument(): boolean {
  return document.body.classList.contains("vertical")
}

// Get current page number from DocSend UI
function getCurrentPageNumber(): number {
  const pageNumber = document.querySelector("#page-number")
  if (pageNumber) {
    const num = parseInt(pageNumber.textContent || "1", 10)
    return isNaN(num) ? 1 : num
  }
  return 1
}

// Detect total pages from DocSend UI
function detectTotalPages(): number | null {
  // Look for page indicator like "1 / 17"
  const pageIndicator = document.querySelector(".toolbar-page-indicator")
  if (pageIndicator) {
    const text = pageIndicator.textContent || ""
    const match = text.match(/(\d+)\s*\/\s*(\d+)/)
    if (match) {
      return parseInt(match[2], 10)
    }
  }

  // Fallback: look for any element with page count
  const pageIndicators = document.querySelectorAll(
    '[class*="page"], [class*="Page"], [aria-label*="page"]'
  )

  for (const indicator of pageIndicators) {
    const text = indicator.textContent || ""
    const match = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i)
    if (match) {
      return parseInt(match[2], 10)
    }
  }

  return null
}

const viewerSelectors = [
  '[data-testid*="viewer"]',
  '[data-testid*="presentation"]',
  '[class*="viewer"]',
  '[class*="Viewer"]',
  '[class*="presentation"]',
  '[role="presentation"]',
  '[role="region"][aria-label*="page"]'
]

function findViewerElement(): HTMLElement | null {
  for (const selector of viewerSelectors) {
    const el = document.querySelector(selector) as HTMLElement | null
    if (el) {
      return el
    }
  }
  return null
}

function focusViewerElement(): HTMLElement | null {
  const viewer = findViewerElement()

  if (!viewer) {
    logCaptureContext("Viewer element not found when attempting focus")
    return null
  }

  const originalTabIndex = viewer.getAttribute("tabindex")
  if (viewer.tabIndex < 0) {
    viewer.setAttribute("data-flow-temp-tabindex", originalTabIndex ?? "")
    viewer.tabIndex = 0
  }

  viewer.focus({ preventScroll: true })
  logCaptureContext("Focused viewer element", {
    viewerTag: viewer.tagName,
    classList: viewer.className,
    tabIndex: viewer.tabIndex,
    activeElement: document.activeElement?.tagName ?? null
  })

  return viewer
}

type ZoomResponse = {
  success: boolean
  adjusted: boolean
  currentZoom?: number
  previousZoom?: number
  error?: string
}

async function ensureDefaultZoom(): Promise<ZoomResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "ENSURE_CAPTURE_ZOOM" },
      (response: ZoomResponse | undefined) => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message
          logCaptureContext("Failed to ensure default zoom", { error: message })
          resolve({ success: false, adjusted: false, error: message })
          return
        }

        if (!response) {
          logCaptureContext("ENSURE_CAPTURE_ZOOM response missing")
          resolve({
            success: false,
            adjusted: false,
            error: "No response from background script"
          })
          return
        }

        logCaptureContext("ENSURE_CAPTURE_ZOOM response received", response)
        resolve(response)
      }
    )
  })
}

async function restoreZoomIfNeeded(): Promise<void> {
  if (!captureState.zoomAdjusted) {
    return
  }

  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "RESTORE_CAPTURE_ZOOM" },
      (response: { success: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          logCaptureContext("RESTORE_CAPTURE_ZOOM failed", {
            error: chrome.runtime.lastError.message
          })
          captureState.zoomAdjusted = false
          resolve()
          return
        }

        if (!response) {
          logCaptureContext("RESTORE_CAPTURE_ZOOM response missing")
          captureState.zoomAdjusted = false
          resolve()
          return
        }

        logCaptureContext("RESTORE_CAPTURE_ZOOM response received", response)
        captureState.zoomAdjusted = false
        resolve()
      }
    )
  })
}

// Navigate to first page
async function navigateToFirstPage(): Promise<boolean> {
  const currentPage = getCurrentPageNumber()

  if (currentPage === 1) {
    logCaptureContext("Already on page 1 before capture start")
    return true // Already on first page
  }

  logCaptureContext(`Navigating from page ${currentPage} to page 1...`)

  // Method 1: Try clicking "Previous" button repeatedly
  const maxAttempts = 50 // Safety limit
  let attempts = 0

  while (getCurrentPageNumber() > 1 && attempts < maxAttempts) {
    const prevButtons = document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label*="previous"], button[aria-label*="Previous"], button[aria-label*="prev"], button[aria-label*="Prev"], [class*="prev"]'
    )

    let clicked = false
    for (const button of prevButtons) {
      if (
        !button.disabled &&
        button.offsetParent !== null &&
        !button.getAttribute("aria-disabled")
      ) {
        button.click()
        clicked = true
        await sleep(800) // Wait for page to load
        break
      }
    }

    if (!clicked) {
      // Try left arrow key
      const arrowKeyEvent = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        keyCode: 37,
        which: 37,
        bubbles: true,
        cancelable: true
      })
      document.body.dispatchEvent(arrowKeyEvent)
      await sleep(800)
    }

    attempts++
  }

  const finalPage = getCurrentPageNumber()
  if (finalPage === 1) {
    logCaptureContext("Successfully navigated to page 1")
    return true
  } else {
    logCaptureContext("Failed to navigate to page 1", {
      finalPage,
      attempts
    })
    return false
  }
}

function describeButton(button: HTMLElement) {
  return {
    text: button.textContent?.trim() ?? null,
    classList: Array.from(button.classList).join(" ") || null,
    disabled:
      (button as HTMLButtonElement).disabled ??
      button.getAttribute("aria-disabled") === "true",
    ariaDisabled: button.getAttribute("aria-disabled") ?? null,
    tabIndex: button.tabIndex,
    role: button.getAttribute("role") ?? null,
    dataTestId: button.getAttribute("data-testid") ?? null
  }
}

// Navigate to next page using multiple methods
async function navigateToNextPage(): Promise<boolean> {
  const currentPage = getCurrentPageNumber()
  logCaptureContext("Attempting to advance to the next page", {
    currentPage
  })

  const viewerBeforeNavigation = focusViewerElement()

  // Method 1: Try clicking "Next" button
  const nextButtonSelectors = [
    'button[aria-label*="next"]',
    'button[aria-label*="Next"]',
    '[role="button"][aria-label*="next"]',
    '[role="button"][aria-label*="Next"]',
    '[aria-label*="next page"]',
    '[aria-label*="Next page"]',
    '[data-testid*="next"]',
    '[data-testid*="forward"]',
    '[data-testid*="right"]',
    '[class*="next"]',
    '[class*="Next"]',
    '[class*="forward"]',
    '[class*="Forward"]',
    '[class*="RightArrow"]',
    '[class*="right-arrow"]'
  ]

  const nextButtonCandidates: HTMLElement[] = []
  for (const selector of nextButtonSelectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      nextButtonCandidates.push(el)
    })
  }

  const uniqueCandidates = Array.from(new Set(nextButtonCandidates))
  logCaptureContext("Next button query result", {
    count: uniqueCandidates.length,
    selectorsTested: nextButtonSelectors
  })

  for (const button of uniqueCandidates) {
    logCaptureContext(
      "Evaluating next button candidate",
      describeButton(button)
    )
    const isDisabled =
      (button as HTMLButtonElement).disabled ||
      button.getAttribute("aria-disabled") === "true"

    if (!isDisabled && button.offsetParent !== null) {
      logCaptureContext("Clicking next button", describeButton(button))
      ;(button as HTMLElement).click()
      await sleep(1500) // Wait for page to load

      const newPage = getCurrentPageNumber()
      if (newPage > currentPage) {
        logCaptureContext("Next button click advanced page", { newPage })
        return true // Successfully navigated
      }

      logCaptureContext("Next button click did not advance page", {
        observedPage: newPage
      })
    }
  }

  // Method 2: Try arrow key navigation
  const activeViewer = viewerBeforeNavigation ?? focusViewerElement()
  logCaptureContext("Dispatching ArrowRight key event", {
    activeElement: document.activeElement?.tagName ?? null,
    activeElementClasses:
      (document.activeElement as HTMLElement | null)?.className ?? null
  })
  const arrowKeyEvent = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    code: "ArrowRight",
    keyCode: 39,
    which: 39,
    bubbles: true,
    cancelable: true
  })
  if (activeViewer) {
    activeViewer.dispatchEvent(arrowKeyEvent)
  } else {
    document.body.dispatchEvent(arrowKeyEvent)
  }
  await sleep(1500)

  let newPage = getCurrentPageNumber()
  if (newPage > currentPage) {
    logCaptureContext("ArrowRight key advanced page", { newPage })
    return true // Arrow key worked
  }
  logCaptureContext("ArrowRight key did not advance page", {
    observedPage: newPage
  })

  // Method 3: Try clicking on the viewer
  const viewer = activeViewer ?? findViewerElement() ?? document.body
  if (viewer) {
    logCaptureContext("Clicking viewer element to advance", {
      viewerTag: viewer.tagName,
      classList: (viewer as Element).className || null
    })
    ;(viewer as HTMLElement).click()
    await sleep(1500)

    newPage = getCurrentPageNumber()
    if (newPage > currentPage) {
      logCaptureContext("Viewer click advanced page", { newPage })
      return true // Click navigation worked
    }

    logCaptureContext("Viewer click did not advance page", {
      observedPage: newPage
    })
  } else {
    logCaptureContext("Viewer element not found when attempting click")
  }

  // No method successfully advanced the page
  logCaptureContext("Failed to advance to the next page", {
    attemptedFromPage: currentPage
  })
  return false
}

// Capture scrollable document by extracting images from DOM
async function captureScrollableDocument(): Promise<string[]> {
  logCaptureContext("Starting scrollable document capture")

  // Try multiple selectors to find page images
  const selectors = [
    "img.preso-view.page-view[data-pagenum]",
    "img.page-view[data-pagenum]",
    "img.preso-view[data-pagenum]",
    ".item img.page-view",
    ".carousel-inner img.page-view"
  ]

  let pageImages: HTMLImageElement[] = []
  for (const selector of selectors) {
    pageImages = Array.from(
      document.querySelectorAll(selector)
    ) as HTMLImageElement[]
    if (pageImages.length > 0) {
      logCaptureContext("Found page images with selector", {
        selector,
        totalImages: pageImages.length
      })
      break
    }
  }

  if (pageImages.length === 0) {
    logCaptureContext("No page images found in DOM with any selector")
    return []
  }

  // Log details about each image for debugging
  logCaptureContext("Image details before loading", {
    images: pageImages.map((img, i) => ({
      index: i,
      pageNum: img.getAttribute("data-pagenum"),
      src: img.src?.substring(0, 80) + "...",
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      hasWhitey: img.src?.includes("whitey")
    }))
  })

  // Scroll through the document to trigger lazy loading if needed
  logCaptureContext("Scrolling to trigger lazy loading...")
  const carouselContainer = document.querySelector(
    ".carousel-inner, .js-carousel-inner"
  ) as HTMLElement
  if (carouselContainer) {
    // Scroll to bottom to ensure all images are triggered
    carouselContainer.scrollTop = carouselContainer.scrollHeight
    await sleep(500)
    // Scroll back to top
    carouselContainer.scrollTop = 0
    await sleep(500)
  }

  // Wait for all images to load
  logCaptureContext("Waiting for all images to load...")
  await Promise.all(
    pageImages.map((img, index) => {
      if (img.complete && img.naturalWidth > 0) {
        logCaptureContext(`Image ${index + 1} already loaded`)
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        const onLoad = () => {
          logCaptureContext(`Image ${index + 1} loaded successfully`)
          resolve()
        }
        const onError = () => {
          logCaptureContext(`Image ${index + 1} failed to load`)
          resolve()
        }
        img.addEventListener("load", onLoad)
        img.addEventListener("error", onError)

        // Timeout after 15 seconds per image
        setTimeout(() => {
          logCaptureContext(`Image ${index + 1} load timeout`)
          resolve()
        }, 15000)
      })
    })
  )

  // Filter out unloaded or error images
  const loadedImages = pageImages.filter(
    (img) => img.complete && img.naturalWidth > 0 && !img.src.includes("whitey")
  )

  logCaptureContext("Images ready to capture", {
    loadedCount: loadedImages.length,
    totalCount: pageImages.length,
    loadedDetails: loadedImages.map((img) => ({
      pageNum: img.getAttribute("data-pagenum"),
      width: img.naturalWidth,
      height: img.naturalHeight
    }))
  })

  if (loadedImages.length === 0) {
    logCaptureContext("No valid images to capture - detailed state", {
      allImages: pageImages.map((img) => ({
        pageNum: img.getAttribute("data-pagenum"),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        src: img.src?.substring(0, 100)
      }))
    })
    return []
  }

  // Scroll to each image and capture it via screenshot
  const screenshots: string[] = []
  const carousel = document.querySelector(
    ".carousel-inner, .js-carousel-inner"
  ) as HTMLElement

  for (let i = 0; i < loadedImages.length; i++) {
    const img = loadedImages[i]
    const pageNum = img.getAttribute("data-pagenum") || (i + 1).toString()

    try {
      // Scroll the image into view
      if (carousel) {
        // Find the parent .item container
        const itemContainer = img.closest(".item") as HTMLElement
        if (itemContainer) {
          // Scroll to show this item
          itemContainer.scrollIntoView({ behavior: "instant", block: "start" })
          await sleep(300) // Wait for scroll to complete
        }
      } else {
        img.scrollIntoView({ behavior: "instant", block: "start" })
        await sleep(300)
      }

      // Capture screenshot using background script
      const screenshot = await captureScreenshot()

      if (screenshot) {
        screenshots.push(screenshot)

        logCaptureContext("Captured page from DOM", {
          pageNum,
          capturedCount: screenshots.length,
          width: img.naturalWidth,
          height: img.naturalHeight
        })

        // Update progress
        captureState.currentPage = parseInt(pageNum, 10)
        captureState.capturedCount = screenshots.length
        sendStatusUpdate()
      } else {
        logCaptureContext("Failed to capture screenshot for page", {
          pageNum
        })
      }
    } catch (error) {
      logCaptureContext("Error capturing page from DOM", {
        pageNum,
        error: error instanceof Error ? error.message : error
      })
    }
  }

  logCaptureContext("Scrollable document capture complete", {
    capturedCount: screenshots.length
  })

  return screenshots
}

// Capture screenshot via background script
async function captureScreenshot(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CAPTURE_SCREENSHOT" },
      (response: { screenshot?: string; error?: string }) => {
        if (response.screenshot) {
          logCaptureContext("captureScreenshot response received", {
            screenshotLength: response.screenshot.length
          })
          resolve(response.screenshot)
        } else {
          logCaptureContext("Screenshot capture failed", {
            error: response.error
          })
          resolve(null)
        }
      }
    )
  })
}

// Send status update to popup and inline button
function sendStatusUpdate() {
  const statusData = {
    isCapturing: captureState.isCapturing,
    currentPage: captureState.currentPage,
    totalPages: captureState.totalPages,
    capturedCount: captureState.capturedCount,
    error: captureState.error
  }

  // Send to popup/background via chrome messaging
  chrome.runtime.sendMessage({
    type: "CAPTURE_STATUS",
    status: statusData
  })

  // Send to inline button via custom event
  document.dispatchEvent(
    new CustomEvent("flow:capture:status", {
      detail: statusData
    })
  )
}

function failCapture(message: string) {
  logCaptureContext("failCapture invoked", { message })
  captureState.isCapturing = false
  captureState.error = message
  captureState.totalPages = null
  captureState.screenshots = []
  captureState.capturedCount = 0
  sendStatusUpdate()
  void restoreZoomIfNeeded()
}

// Main capture loop
async function startCapture() {
  if (captureState.isCapturing) {
    console.log("Capture already in progress")
    return
  }

  // Clear any previous upload/capture state from storage
  chrome.runtime.sendMessage({
    type: "CLEAR_STATES"
  })

  captureState.isCapturing = true
  captureState.error = undefined
  const detectedTotalPages = detectTotalPages()

  if (detectedTotalPages === null) {
    logCaptureContext("Failed to detect total pages before capture")
    failCapture(
      "Flow couldn't detect how many pages are in this DocSend. Wait for the viewer to load and try again."
    )
    return
  }

  captureState.totalPages = detectedTotalPages
  captureState.screenshots = []
  captureState.zoomAdjusted = false

  // Check if this is a scrollable document
  const isVertical = isScrollableDocument()
  logCaptureContext("Document type detected", {
    isScrollable: isVertical,
    totalPages: detectedTotalPages
  })

  // Branch based on document type
  if (isVertical) {
    // Scrollable document: capture images directly from DOM
    logCaptureContext("Using scrollable document capture method")

    try {
      captureState.isCapturing = true
      captureState.currentPage = 1
      sendStatusUpdate()

      const screenshots = await captureScrollableDocument()

      if (screenshots.length === 0) {
        logCaptureContext("No images captured from scrollable document")
        failCapture(
          "Flow couldn't load the document images. Please wait for the document to fully load and try again."
        )
        return
      }

      captureState.screenshots = screenshots
      captureState.capturedCount = screenshots.length

      // Upload screenshots
      if (captureState.screenshots.length > 0) {
        logCaptureContext("Sending UPLOAD_SCREENSHOTS message", {
          screenshotCount: captureState.screenshots.length
        })
        chrome.runtime.sendMessage(
          {
            type: "UPLOAD_SCREENSHOTS",
            screenshots: captureState.screenshots,
            metadata: {
              url: window.location.href,
              totalPages: captureState.screenshots.length,
              capturedAt: new Date().toISOString()
            }
          },
          (response) => {
            logCaptureContext("UPLOAD_SCREENSHOTS response received", {
              response
            })
          }
        )
      }

      captureState.isCapturing = false
      sendStatusUpdate()

      // Reset after a delay to allow success message to show
      setTimeout(() => {
        captureState.currentPage = 0
        captureState.capturedCount = 0
      }, 3500)

      return
    } catch (error) {
      logCaptureContext("Scrollable document capture error", {
        error: error instanceof Error ? error.message : error
      })
      failCapture(
        error instanceof Error
          ? error.message
          : "Failed to capture scrollable document"
      )
      return
    }
  }

  // Presentation mode: use existing navigation-based capture
  logCaptureContext("Using presentation capture method (with navigation)")

  const zoomResult = await ensureDefaultZoom()
  if (!zoomResult.success) {
    logCaptureContext("Unable to ensure default zoom before capture", {
      error: zoomResult.error
    })
    failCapture(
      "Flow needs Chrome zoom set to 100% before capturing. Press Ctrl+0 (Cmd+0 on Mac) to reset zoom and try again."
    )
    return
  }

  captureState.zoomAdjusted = zoomResult.adjusted
  if (zoomResult.adjusted) {
    logCaptureContext("Adjusted tab zoom to 100% for capture", {
      previousZoom: zoomResult.previousZoom,
      currentZoom: zoomResult.currentZoom
    })
  } else {
    logCaptureContext("Tab already at 100% zoom for capture", {
      currentZoom: zoomResult.currentZoom
    })
  }

  // Navigate to first page before starting capture
  logCaptureContext("Navigating to page 1 before starting capture...")
  const navigatedToFirst = await navigateToFirstPage()

  if (!navigatedToFirst) {
    logCaptureContext("Navigation to first page failed")
    failCapture(
      "Flow couldn't navigate to the first page. Please manually go to page 1 and try again."
    )
    return
  }

  // Get current page from UI (should be 1 now)
  captureState.currentPage = getCurrentPageNumber()
  if (captureState.currentPage !== 1) {
    logCaptureContext("Unexpected current page after navigation", {
      currentPage: captureState.currentPage
    })
    failCapture(
      "Flow couldn't navigate to page 1. Please manually go to page 1 and try again."
    )
    return
  }

  sendStatusUpdate()

  console.log(
    `Starting capture: Page ${captureState.currentPage} of ${captureState.totalPages}`
  )

  try {
    // Capture first page
    logCaptureContext("Capturing page 1...")
    const firstScreenshot = await captureScreenshot()
    if (firstScreenshot) {
      captureState.screenshots.push(firstScreenshot)
      logCaptureContext("Screenshot 1 captured", {
        screenshotCount: captureState.screenshots.length,
        screenshotLength: firstScreenshot.length
      })
    } else {
      logCaptureContext("Failed to capture screenshot 1")
    }

    // Navigate and capture remaining pages
    while (captureState.isCapturing) {
      const hasNextPage = await navigateToNextPage()

      if (!hasNextPage) {
        logCaptureContext("No more pages to capture based on navigation result")
        break
      }

      // Update current page from UI
      captureState.currentPage = getCurrentPageNumber()
      const verifiedTotalPages = detectTotalPages()

      if (verifiedTotalPages === null) {
        logCaptureContext("Lost track of total page count mid-capture")
        failCapture(
          "Flow lost track of the total page count. Reload the DocSend and try again."
        )
        return
      }

      captureState.totalPages = verifiedTotalPages

      if (captureState.currentPage > verifiedTotalPages) {
        logCaptureContext("Detected inconsistent page numbers", {
          currentPage: captureState.currentPage,
          verifiedTotalPages
        })
        failCapture(
          "Flow detected inconsistent page numbers. Reload the DocSend and try again."
        )
        return
      }

      sendStatusUpdate()

      logCaptureContext(
        `Capturing page ${captureState.currentPage} of ${captureState.totalPages}`,
        {
          screenshotCount: captureState.screenshots.length
        }
      )

      const screenshot = await captureScreenshot()
      if (screenshot) {
        captureState.screenshots.push(screenshot)
        logCaptureContext("Screenshot captured", {
          screenshotCount: captureState.screenshots.length,
          screenshotLength: screenshot.length,
          currentPage: captureState.currentPage
        })
      } else {
        logCaptureContext("Failed to capture screenshot for current page", {
          currentPage: captureState.currentPage
        })
      }

      // Safety check: stop if current page exceeds total
      if (
        captureState.totalPages !== null &&
        captureState.currentPage >= captureState.totalPages
      ) {
        logCaptureContext("Reached last page based on totalPages")
        break
      }

      // Safety check: stop if we've captured more than 500 pages
      if (captureState.screenshots.length > 500) {
        logCaptureContext("Safety limit reached (500 pages)")
        break
      }
    }

    logCaptureContext("Capture loop finished", {
      screenshotCount: captureState.screenshots.length
    })

    // Only upload if we have screenshots (i.e., capture wasn't manually stopped)
    if (captureState.screenshots.length > 0) {
      logCaptureContext("Sending UPLOAD_SCREENSHOTS message", {
        screenshotCount: captureState.screenshots.length
      })
      chrome.runtime.sendMessage(
        {
          type: "UPLOAD_SCREENSHOTS",
          screenshots: captureState.screenshots,
          metadata: {
            url: window.location.href,
            totalPages: captureState.screenshots.length,
            capturedAt: new Date().toISOString()
          }
        },
        (response) => {
          logCaptureContext("UPLOAD_SCREENSHOTS response received", {
            response
          })
        }
      )
    } else {
      logCaptureContext("Capture was stopped before uploads")
    }
  } catch (error) {
    logCaptureContext("Capture error thrown", {
      error: error instanceof Error ? error.message : error
    })
    chrome.runtime.sendMessage({
      type: "CAPTURE_STATUS",
      status: {
        isCapturing: false,
        currentPage: captureState.currentPage,
        totalPages: captureState.totalPages,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    })
  } finally {
    captureState.isCapturing = false
    captureState.capturedCount = captureState.screenshots.length
    sendStatusUpdate()
    logCaptureContext("Capture state finalized", {
      capturedCount: captureState.capturedCount
    })
    await restoreZoomIfNeeded()

    // Reset after a delay to allow success message to show
    setTimeout(() => {
      captureState.currentPage = 0
      captureState.capturedCount = 0
      captureState.zoomAdjusted = false
    }, 3500)
  }
}

function stopCapture() {
  logCaptureContext("STOP_CAPTURE received; clearing state")
  void restoreZoomIfNeeded()
  captureState.isCapturing = false
  captureState.screenshots = [] // Clear screenshots to prevent upload
  captureState.currentPage = 0
  captureState.totalPages = null
  captureState.capturedCount = 0
  captureState.error = undefined
  sendStatusUpdate()
  captureState.zoomAdjusted = false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener(
  (
    message: { type: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: { success: boolean }) => void
  ) => {
    if (message.type === "START_CAPTURE") {
      startCapture()
      sendResponse({ success: true })
    } else if (message.type === "STOP_CAPTURE") {
      stopCapture()
      sendResponse({ success: true })
    }

    return true // Keep message channel open for async response
  }
)

// Listen for events from inline capture button
document.addEventListener("flow:capture:start", () => {
  startCapture()
})

document.addEventListener("flow:capture:stop", () => {
  stopCapture()
})

console.log("Flow DocSend capture content script loaded")
