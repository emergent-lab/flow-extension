import "@testing-library/jest-dom"

import React from "react"
import { beforeEach, vi } from "vitest"

import { resetChromeStorage, setupChromeMocks } from "./mocks/chrome"

// Make React globally available for JSX
Reflect.set(globalThis, "React", React)

// Setup Chrome API mocks before all tests
setupChromeMocks()

// Reset mocks between tests
beforeEach(() => {
  // Clear localStorage
  localStorage.clear()

  // Reset chrome storage data
  resetChromeStorage()

  // Reset module mocks
  vi.clearAllMocks()

  // Re-setup Chrome mocks after clearing (to restore chrome.storage spies)
  setupChromeMocks()
})
