/**
 * R2 Direct Upload for Chrome Extension
 * Simplified multipart upload using presigned URLs
 * Adapted from src/app/lib/upload-client.ts for extension environment
 */

export interface UploadProgress {
  uploadedBytes: number
  totalBytes: number
  percent: number
  currentFile: number
  totalFiles: number
}

export interface ScreenshotUploadResult {
  key: string
  filename: string
}

interface MultipartSession {
  uploadId: string
  key: string
  partSize: number
  totalParts: number
}

/**
 * Convert data URL to Blob
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(",")
  const contentType = parts[0].match(/:(.*?);/)?.[1] || "image/png"
  const base64 = parts[1]
  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new Blob([array], { type: contentType })
}

/**
 * Get web app URL from environment
 */
function getWebAppUrl(path: string = ""): string {
  const frontendUrl =
    process.env.PLASMO_PUBLIC_FRONTEND_URL || "http://localhost:3000"
  return `${frontendUrl}${path}`
}

/**
 * Upload a single screenshot part to R2
 */
async function uploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  data: Blob,
  authHeaders: Record<string, string>,
  maxRetries = 3
): Promise<{ PartNumber: number; ETag: string }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Get presigned URL
      const signResponse = await fetch(
        getWebAppUrl(
          `/api/upload/sign?${new URLSearchParams({
            key,
            uploadId,
            partNumber: String(partNumber)
          })}`
        ),
        {
          method: "GET",
          headers: authHeaders
        }
      )

      if (!signResponse.ok) {
        throw new Error(`Failed to get upload URL: ${signResponse.statusText}`)
      }

      const { url } = await signResponse.json()

      // Upload part directly to R2
      const uploadResponse = await fetch(url, {
        method: "PUT",
        body: data,
        headers: {
          "Content-Type": "application/octet-stream"
        }
      })

      if (!uploadResponse.ok) {
        throw new Error(
          `Failed to upload part ${partNumber}: ${uploadResponse.statusText}`
        )
      }

      // Extract ETag from response headers
      const etag = uploadResponse.headers.get("ETag")?.replace(/"/g, "")
      if (!etag) {
        throw new Error("Missing ETag in upload response")
      }

      return { PartNumber: partNumber, ETag: etag }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error("Failed to upload part after retries")
}

/**
 * Upload a single screenshot to R2 using multipart upload
 */
async function uploadScreenshot(
  dataUrl: string,
  filename: string,
  authHeaders: Record<string, string>,
  onProgress?: (uploaded: number, total: number) => void
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl)
  const size = blob.size

  // Create multipart upload session
  const createResponse = await fetch(getWebAppUrl("/api/upload/create"), {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      mime: "image/png",
      size
    })
  })

  if (!createResponse.ok) {
    const error = await createResponse.json()
    throw new Error(error.error || "Failed to create upload session")
  }

  const { uploadId, key, partSize, totalParts }: MultipartSession =
    await createResponse.json()

  // Upload parts
  const completedParts: { PartNumber: number; ETag: string }[] = []

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, size)
    const partBlob = blob.slice(start, end)

    const part = await uploadPart(key, uploadId, partNumber, partBlob, authHeaders)
    completedParts.push(part)

    // Report progress
    if (onProgress) {
      const uploaded = Math.min(partNumber * partSize, size)
      onProgress(uploaded, size)
    }
  }

  // Complete multipart upload
  const completeResponse = await fetch(getWebAppUrl("/api/upload/complete"), {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      uploadId,
      parts: completedParts.sort((a, b) => a.PartNumber - b.PartNumber)
    })
  })

  if (!completeResponse.ok) {
    // Try to abort the upload
    try {
      await fetch(getWebAppUrl("/api/upload/abort"), {
        method: "DELETE",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId })
      })
    } catch (abortError) {
      console.warn("Failed to abort upload:", abortError)
    }

    const error = await completeResponse.json()
    throw new Error(error.error || "Failed to complete upload")
  }

  return key
}

/**
 * Upload multiple screenshots to R2 in parallel
 * Returns array of R2 keys in the same order as input
 */
export async function uploadScreenshots(
  screenshots: string[],
  onProgress?: (progress: UploadProgress) => void,
  concurrency = 4
): Promise<ScreenshotUploadResult[]> {
  const authHeaders = await getAuthHeaders()
  // Pre-allocate results array to maintain order
  const results: (ScreenshotUploadResult | null)[] = new Array(
    screenshots.length
  ).fill(null)

  // Calculate size of each screenshot
  const sizePerScreenshot = screenshots.map(
    (dataUrl) => dataUrlToBlob(dataUrl).size
  )
  const totalBytes = sizePerScreenshot.reduce((sum, size) => sum + size, 0)

  // Track bytes uploaded per screenshot (for aggregating progress)
  const bytesPerScreenshot = new Map<number, number>()

  // Create queue of screenshot indexes to upload
  const queue = screenshots.map((_, i) => i)

  // Worker function to process queue items
  const worker = async () => {
    while (queue.length > 0) {
      const index = queue.shift()!
      const filename = `page_${index + 1}.png`

      try {
        // Upload with per-file progress tracking
        const key = await uploadScreenshot(
          screenshots[index],
          filename,
          authHeaders,
          (uploaded, _total) => {
            // Update bytes for this specific screenshot
            bytesPerScreenshot.set(index, uploaded)

            // Aggregate total progress across all screenshots
            const totalUploaded = Array.from(
              bytesPerScreenshot.values()
            ).reduce((sum, bytes) => sum + bytes, 0)

            // Report aggregated progress
            onProgress?.({
              uploadedBytes: totalUploaded,
              totalBytes,
              percent: Math.round((totalUploaded / totalBytes) * 100),
              currentFile: bytesPerScreenshot.size,
              totalFiles: screenshots.length
            })
          }
        )

        // Store result in correct position to maintain order
        results[index] = { key, filename }

        // Mark this screenshot as fully uploaded
        bytesPerScreenshot.set(index, sizePerScreenshot[index])

        console.log(
          `[Upload] Completed ${filename} (${bytesPerScreenshot.size}/${screenshots.length})`
        )
      } catch (error) {
        console.error(`[Upload] Failed to upload ${filename}:`, error)
        throw error // Re-throw to fail the entire upload
      }
    }
  }

  // Spawn concurrent workers (up to concurrency limit or number of screenshots)
  const numWorkers = Math.min(concurrency, screenshots.length)
  console.log(
    `[Upload] Starting ${numWorkers} concurrent upload workers for ${screenshots.length} screenshots`
  )

  const workers = Array.from({ length: numWorkers }, worker)
  await Promise.all(workers)

  // Verify all results are present
  if (results.some((r) => r === null)) {
    throw new Error("Some screenshots failed to upload")
  }

  return results as ScreenshotUploadResult[]
}
import { getAuthHeaders } from "./clerk-auth"
