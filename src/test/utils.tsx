import { render, RenderOptions } from "@testing-library/react"
import { ReactElement } from "react"

/**
 * Custom render function that wraps components with necessary providers
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) {
  return render(ui, { ...options })
}

/**
 * Wait for async operations to complete
 */
export function waitFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock File object
 */
export function createMockFile(
  name: string,
  size: number,
  type: string = "image/png"
): File {
  const blob = new Blob(["x".repeat(size)], { type })
  return new File([blob], name, { type })
}

/**
 * Create a mock data URL (base64 encoded image)
 */
export function createMockDataUrl(size: number = 100): string {
  // Small 1x1 PNG
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  return `data:image/png;base64,${base64}`
}

/**
 * Mock fetch response
 */
export function mockFetchResponse(
  data: unknown,
  ok: boolean = true,
  status: number = 200
) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ "Content-Type": "application/json" })
  } as Response
}

/**
 * Create mock upload progress
 */
export interface MockUploadProgress {
  uploadedBytes: number
  totalBytes: number
  percent: number
  currentFile: number
  totalFiles: number
}

export function createMockUploadProgress(
  currentFile: number,
  totalFiles: number,
  fileSize: number = 1000
): MockUploadProgress {
  const uploadedBytes = currentFile * fileSize
  const totalBytes = totalFiles * fileSize
  return {
    uploadedBytes,
    totalBytes,
    percent: Math.round((uploadedBytes / totalBytes) * 100),
    currentFile,
    totalFiles
  }
}

// Re-export testing library utilities
export * from "@testing-library/react"
export { default as userEvent } from "@testing-library/user-event"
