import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockDataUrl, mockFetchResponse } from "../test/utils"
import { uploadScreenshots } from "./upload-to-r2"

// Mock environment
const mockWebAppUrl = "http://localhost:3000"
vi.stubEnv("PLASMO_PUBLIC_CLERK_SYNC_HOST", mockWebAppUrl)

const mockGetAuthHeaders = vi.hoisted(() =>
  vi.fn(async () => ({
    Authorization: "Bearer test-token"
  }))
)

vi.mock("./clerk-auth", () => ({
  getAuthHeaders: mockGetAuthHeaders
}))

describe("upload-to-r2", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockClear()
    global.fetch = vi.fn()
  })

  describe("uploadScreenshots", () => {
    it("should upload multiple screenshots in parallel", async () => {
      const screenshots = [
        createMockDataUrl(),
        createMockDataUrl(),
        createMockDataUrl(),
        createMockDataUrl()
      ]

      // Mock the API responses
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: "test-key",
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ ETag: '"test-etag"' })
            } as Response)
          }
          if (url.includes("/api/upload/complete")) {
            return Promise.resolve(mockFetchResponse({ success: true }))
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      const onProgress = vi.fn()
      const results = await uploadScreenshots(screenshots, onProgress, 4)

      expect(mockGetAuthHeaders).toHaveBeenCalledTimes(1)
      // Verify results maintain order
      expect(results).toHaveLength(4)
      expect(results[0].filename).toBe("page_1.png")
      expect(results[1].filename).toBe("page_2.png")
      expect(results[2].filename).toBe("page_3.png")
      expect(results[3].filename).toBe("page_4.png")

      // Verify progress was reported
      expect(onProgress).toHaveBeenCalled()
      const lastProgress =
        onProgress.mock.calls[onProgress.mock.calls.length - 1][0]
      expect(lastProgress.percent).toBe(100)
      expect(lastProgress.currentFile).toBe(4)
      expect(lastProgress.totalFiles).toBe(4)
    })

    it("should respect concurrency limit", async () => {
      const screenshots = Array(10)
        .fill(null)
        .map(() => createMockDataUrl())
      let concurrentRequests = 0
      let maxConcurrent = 0

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string) => {
          if (url.includes("/api/upload/create")) {
            concurrentRequests++
            maxConcurrent = Math.max(maxConcurrent, concurrentRequests)

            await new Promise((resolve) => setTimeout(resolve, 10))
            concurrentRequests--

            return mockFetchResponse({
              uploadId: "test-upload-id",
              key: "test-key",
              partSize: 5242880,
              totalParts: 1
            })
          }
          if (url.includes("/api/upload/sign")) {
            return mockFetchResponse({
              url: "https://r2.cloudflare.com/presigned-url"
            })
          }
          if (url.includes("r2.cloudflare.com")) {
            return {
              ok: true,
              headers: new Headers({ ETag: '"test-etag"' })
            } as Response
          }
          if (url.includes("/api/upload/complete")) {
            return mockFetchResponse({ success: true })
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      await uploadScreenshots(screenshots, undefined, 4)

      // Verify concurrency was respected (should not exceed 4)
      expect(maxConcurrent).toBeLessThanOrEqual(4)
    })

    it("should maintain file ordering", async () => {
      const screenshots = Array(17)
        .fill(null)
        .map(() => createMockDataUrl())

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: `test-key-${Math.random()}`,
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ ETag: '"test-etag"' })
            } as Response)
          }
          if (url.includes("/api/upload/complete")) {
            return Promise.resolve(mockFetchResponse({ success: true }))
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      const results = await uploadScreenshots(screenshots, undefined, 4)

      // Verify all results are in correct order
      for (let i = 0; i < results.length; i++) {
        expect(results[i].filename).toBe(`page_${i + 1}.png`)
      }
    })

    it("should retry failed uploads", async () => {
      const screenshots = [createMockDataUrl()]
      let attemptCount = 0

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: "test-key",
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            attemptCount++
            if (attemptCount < 3) {
              // Fail first 2 attempts
              return Promise.resolve({
                ok: false,
                statusText: "Server Error"
              } as Response)
            }
            // Succeed on 3rd attempt
            return Promise.resolve({
              ok: true,
              headers: new Headers({ ETag: '"test-etag"' })
            } as Response)
          }
          if (url.includes("/api/upload/complete")) {
            return Promise.resolve(mockFetchResponse({ success: true }))
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      const results = await uploadScreenshots(screenshots, undefined, 4)

      expect(results).toHaveLength(1)
      expect(attemptCount).toBeGreaterThanOrEqual(3)
    })

    it("should throw error after max retries", async () => {
      const screenshots = [createMockDataUrl()]

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: "test-key",
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            // Always fail
            return Promise.resolve({
              ok: false,
              statusText: "Server Error"
            } as Response)
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      await expect(
        uploadScreenshots(screenshots, undefined, 4)
      ).rejects.toThrow()
    })

    it("should report accurate progress", async () => {
      const screenshots = [
        createMockDataUrl(),
        createMockDataUrl(),
        createMockDataUrl()
      ]
      const progressUpdates: any[] = []

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: "test-key",
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ ETag: '"test-etag"' })
            } as Response)
          }
          if (url.includes("/api/upload/complete")) {
            return Promise.resolve(mockFetchResponse({ success: true }))
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      await uploadScreenshots(
        screenshots,
        (progress) => {
          progressUpdates.push({ ...progress })
        },
        4
      )

      // Verify progress increases monotonically
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i].percent).toBeGreaterThanOrEqual(
          progressUpdates[i - 1].percent
        )
      }

      // Verify final progress is 100%
      const lastUpdate = progressUpdates[progressUpdates.length - 1]
      expect(lastUpdate.percent).toBe(100)
      expect(lastUpdate.currentFile).toBe(3)
      expect(lastUpdate.totalFiles).toBe(3)
    })

    it("should handle empty screenshots array", async () => {
      const results = await uploadScreenshots([], undefined, 4)
      expect(results).toEqual([])
    })

    it("should abort remaining uploads on failure", async () => {
      const screenshots = [
        createMockDataUrl(),
        createMockDataUrl(),
        createMockDataUrl(),
        createMockDataUrl()
      ]

      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) => {
          if (url.includes("/api/upload/create")) {
            return Promise.resolve(
              mockFetchResponse({
                uploadId: "test-upload-id",
                key: "test-key",
                partSize: 5242880,
                totalParts: 1
              })
            )
          }
          if (url.includes("/api/upload/sign")) {
            return Promise.resolve(
              mockFetchResponse({
                url: "https://r2.cloudflare.com/presigned-url"
              })
            )
          }
          if (url.includes("r2.cloudflare.com")) {
            // Fail all uploads after max retries
            return Promise.resolve({
              ok: false,
              statusText: "Server Error"
            } as Response)
          }
          return Promise.reject(new Error("Unknown URL"))
        }
      )

      await expect(
        uploadScreenshots(screenshots, undefined, 4)
      ).rejects.toThrow()
    })
  })
})
