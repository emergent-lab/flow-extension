/**
 * Chrome API mocks for testing
 * Mocks essential Chrome extension APIs used by the extension
 */

interface StorageData {
  [key: string]: unknown
}

interface MessageListener {
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | void
}

const storageData: StorageData = {}
const messageListeners: Set<MessageListener> = new Set()

// Storage change listeners
const storageChangeListeners: Set<(changes: any, areaName: string) => void> = new Set()

export function setupChromeMocks() {
  // Mock chrome.storage.local with onChanged support for @plasmohq/storage
  global.chrome = {
    storage: {
      local: {
        get: vi.fn((keys, callback) => {
          if (typeof keys === "function") {
            callback = keys
            keys = null
          }

          const result: StorageData = {}
          if (keys === null || keys === undefined) {
            Object.assign(result, storageData)
          } else if (typeof keys === "string") {
            if (keys in storageData) {
              result[keys] = storageData[keys]
            }
          } else if (Array.isArray(keys)) {
            keys.forEach((key) => {
              if (key in storageData) {
                result[key] = storageData[key]
              }
            })
          } else {
            Object.keys(keys).forEach((key) => {
              result[key] = storageData[key] ?? keys[key]
            })
          }

          if (callback) {
            callback(result)
          }
          return Promise.resolve(result)
        }),
        set: vi.fn((items, callback) => {
          // Track old values for change events
          const changes: any = {}
          Object.keys(items).forEach((key) => {
            changes[key] = {
              oldValue: storageData[key],
              newValue: items[key]
            }
          })

          // Update storage
          Object.assign(storageData, items)

          // Notify listeners
          storageChangeListeners.forEach((listener) => {
            listener(changes, "local")
          })

          if (callback) {
            callback()
          }
          return Promise.resolve()
        }),
        remove: vi.fn((keys, callback) => {
          const keysArray = Array.isArray(keys) ? keys : [keys]
          const changes: any = {}

          keysArray.forEach((key) => {
            if (key in storageData) {
              changes[key] = {
                oldValue: storageData[key],
                newValue: undefined
              }
              delete storageData[key]
            }
          })

          // Notify listeners
          if (Object.keys(changes).length > 0) {
            storageChangeListeners.forEach((listener) => {
              listener(changes, "local")
            })
          }

          if (callback) {
            callback()
          }
          return Promise.resolve()
        }),
        clear: vi.fn((callback) => {
          const changes: any = {}

          Object.keys(storageData).forEach((key) => {
            changes[key] = {
              oldValue: storageData[key],
              newValue: undefined
            }
            delete storageData[key]
          })

          // Notify listeners
          if (Object.keys(changes).length > 0) {
            storageChangeListeners.forEach((listener) => {
              listener(changes, "local")
            })
          }

          if (callback) {
            callback()
          }
          return Promise.resolve()
        })
      },
      onChanged: {
        addListener: vi.fn((listener) => {
          storageChangeListeners.add(listener)
        }),
        removeListener: vi.fn((listener) => {
          storageChangeListeners.delete(listener)
        }),
        hasListener: vi.fn((listener) => {
          return storageChangeListeners.has(listener)
        })
      }
    },

    // Mock chrome.runtime
    runtime: {
      sendMessage: vi.fn((message, responseCallback) => {
        // In tests, runtime.sendMessage is just a spy
        // It doesn't actually trigger listeners to prevent infinite loops
        // Use triggerChromeMessage() in tests to simulate incoming messages
        if (responseCallback) {
          responseCallback({ success: true })
        }
        return Promise.resolve({ success: true })
      }),
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          messageListeners.add(listener)
        }),
        removeListener: vi.fn((listener: MessageListener) => {
          messageListeners.delete(listener)
        })
      },
      onMessageExternal: {
        addListener: vi.fn(() => {
          // External message listener mock (for web app communication)
        }),
        removeListener: vi.fn(() => {
          // External message listener mock
        })
      },
      getURL: vi.fn((path: string) => `chrome-extension://fake-id/${path}`),
      getManifest: vi.fn(() => ({
        version: "0.0.1",
        name: "Flow",
        manifest_version: 3
      }))
    },

    // Mock chrome.tabs
    tabs: {
      query: vi.fn((queryInfo, callback) => {
        const tabs = [
          {
            id: 1,
            url: "https://docsend.com/view/test",
            active: true,
            windowId: 1
          }
        ]
        if (callback) {
          callback(tabs)
        }
        return Promise.resolve(tabs)
      }),
      sendMessage: vi.fn((tabId, message, responseCallback) => {
        // Simulate sending to content script
        if (responseCallback) {
          responseCallback({ success: true })
        }
        return Promise.resolve({ success: true })
      })
    },

    // Mock chrome.notifications
    notifications: {
      create: vi.fn((notificationId, options, callback) => {
        if (callback) {
          callback(notificationId || "notification-id")
        }
        return Promise.resolve(notificationId || "notification-id")
      })
    },

    // Mock chrome.debugger (for screenshot capture)
    debugger: {
      attach: vi.fn((target, version) => {
        return Promise.resolve()
      }),
      detach: vi.fn((target) => {
        return Promise.resolve()
      }),
      sendCommand: vi.fn((target, method, params) => {
        // Mock screenshot capture
        if (method === "Page.captureScreenshot") {
          return Promise.resolve({
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          })
        }
        return Promise.resolve({})
      })
    }
  } as unknown as typeof chrome
}

// Helper to reset storage between tests
export function resetChromeStorage() {
  Object.keys(storageData).forEach((key) => delete storageData[key])
  storageChangeListeners.clear()
}

// Helper to reset message listeners
export function resetMessageListeners() {
  messageListeners.clear()
}

// Helper to trigger a message to all listeners
export async function triggerChromeMessage(
  message: unknown,
  sender?: chrome.runtime.MessageSender
) {
  const mockSender =
    sender || ({ tab: { id: 1 } } as chrome.runtime.MessageSender)
  const responses: unknown[] = []

  messageListeners.forEach((listener) => {
    const sendResponse = (response: unknown) => {
      responses.push(response)
    }
    listener(message, mockSender, sendResponse)
  })

  // Wait for React to process state updates using queueMicrotask
  // This works even when fake timers are active
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

  return responses
}

// Helper to get current storage data
export function getChromeStorageData() {
  return { ...storageData }
}

// Helper to set storage data for testing
export function setChromeStorageData(data: StorageData) {
  Object.assign(storageData, data)
}
