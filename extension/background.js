/**
 * ScrollGuard AI – Background Service Worker
 *
 * Handles batch link analysis and messaging between content scripts and backend.
 * Acts as a proxy between the content script and the FastAPI backend so that
 * fetch requests are executed in the extension's privileged context, avoiding
 * CORS and Mixed Content restrictions that block content scripts and popups
 * running on HTTPS pages.
 *
 * Every backend call is wrapped in an abort-based timeout plus error guards
 * and always resolves with either the result array or a clean fallback
 * object ({ success: false, error, status: "Safe" }).  Timeouts and network
 * failures are resolved gracefully — no unhandled rejections and no
 * console.error — so Chrome never raises the extension error badge.
 */

/**
 * Backend URL configuration.
 *
 * Priority:
 *   1. chrome.storage.local value set by the user (key: "sg_backendUrl")
 *   2. Default localhost URL for local development
 *
 * To point the extension at a cloud-deployed backend, open the browser
 * console on the service-worker page and run:
 *   chrome.storage.local.set({ sg_backendUrl: "https://your-app.onrender.com/scan_links" })
 */
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/scan_links";

/**
 * Hard timeout for backend requests.  25 s gives multi-URL Qwen LLM
 * batches room to complete while still resolving the graceful fallback
 * before the content script's 30 s race deadline.
 */
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Resolve the backend URL from chrome.storage or fall back to default.
 */
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get("sg_backendUrl", (data) => {
      resolve(data.sg_backendUrl || DEFAULT_BACKEND_URL);
    });
  });
}

/**
 * Send array of URLs to backend for AI analysis.
 * Returns the parsed result array, or a clean fallback object on failure.
 *
 * Robustness:
 *   - AbortController timeout so a hung backend never blocks the caller.
 *   - Timeouts and network failures resolve gracefully — never rethrown
 *     and never logged with console.error — so Chrome does not raise
 *     the extension error badge when the backend is slow or down.
 *   - Validates the response is a JSON array before returning it.
 */
async function analyzeLinksBatch(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return {
      success: false,
      error: "No links provided for analysis.",
      status: "Safe",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const backendUrl = await getBackendUrl();

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: links }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: "Backend returned HTTP " + response.status,
        status: "Safe",
      };
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return {
        success: false,
        error: "Unexpected response format from backend.",
        status: "Safe",
      };
    }

    return data;
  } catch (err) {
    // Abort fired by the timeout above (or an aborted connection).
    // Some Chrome versions reject with a TypeError whose message is
    // "signal is aborted without reason" instead of a DOMException
    // named "AbortError", so match on both the name and the message.
    const isAbort =
      (err && err.name === "AbortError") ||
      /abort/i.test(String((err && err.message) || ""));

    if (isAbort) {
      // Graceful fallback — no console.error, no unhandled rejection,
      // so Chrome's extension error badge stays clean.
      return { success: false, error: "Backend timeout", status: "Safe" };
    }

    // Network-level failure (backend unreachable, DNS, mixed content).
    // Also resolved gracefully; the popup surfaces this message when a
    // manual scan is requested.
    return {
      success: false,
      error:
        "Backend unreachable: " + String((err && err.message) || "network error"),
      status: "Safe",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Listen for messages from content scripts.
 * Expected message: { action: "scanPageLinks", links: [array of URLs] }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "scanPageLinks") {
    analyzeLinksBatch(message.links)
      .then(sendResponse)
      .catch(() =>
        // Belt-and-suspenders: never let an unexpected failure surface
        // as an unhandled rejection in the service worker.
        sendResponse({
          success: false,
          error: "Background analysis failed.",
          status: "Safe",
        })
      );
    return true; // keep channel open for async response
  }
});
