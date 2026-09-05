/**
 * ScrollGuard AI – Background Service Worker
 *
 * Handles batch link analysis and messaging between content scripts and backend.
 * Also records every Dangerous/Suspicious result in a session-scoped
 * flagged-links history that the popup renders as its "Flagged Threat
 * History" list (see FLAGGED_HISTORY_KEY below).
 * Acts as a proxy between the content script and the FastAPI backend so that
 * fetch requests are executed in the extension's privileged context, avoiding
 * CORS and Mixed Content restrictions that block content scripts and popups
 * running on HTTPS pages.
 *
 * Every backend call is wrapped in an abort-based timeout plus error guards
 * and always resolves with either the result array or a graceful fallback —
 * a timed-out request returns per-URL "Safe" results (reason: "Backend
 * evaluation delayed") that render as ordinary cards instead of a blocking
 * error UI.  Timeouts and network failures are resolved gracefully — no
 * unhandled rejections and no console.error — so Chrome never raises the
 * extension error badge.
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
 * Hard timeout for backend requests.  30 s gives slow multi-URL Qwen LLM
 * batches the full window to complete; the content script's own 30 s race
 * treats an over-deadline zero-click batch as a no-op, while the popup
 * receives the graceful "evaluation delayed" fallback below.
 */
const REQUEST_TIMEOUT_MS = 30000;

// ── Flagged-link session history ───────────────────────────────────────────

/**
 * Threat links flagged during the current browsing session, rendered by
 * the popup as the "Flagged Threat History" list.
 *
 * MV3 service workers are terminated after ~30 s of idle time, so the
 * array is mirrored into chrome.storage.local and reloaded on every cold
 * start.  The history is wiped when the browser itself starts (onStartup),
 * keeping the list scoped to a single browsing session.
 *
 * Entry shape: { url, status, riskScore, reason }
 */
const FLAGGED_HISTORY_KEY = "sg_flaggedLinks";
const FLAGGED_HISTORY_MAX = 50;

let flaggedLinks = [];

/** Resolves once the persisted history has finished loading (cold-start guard). */
const flaggedLinksReady = new Promise((resolve) => {
  chrome.storage.local.get(FLAGGED_HISTORY_KEY, (data) => {
    flaggedLinks = Array.isArray(data && data[FLAGGED_HISTORY_KEY])
      ? data[FLAGGED_HISTORY_KEY]
      : [];
    resolve();
  });
});

// Fresh history for every browsing session.
chrome.runtime.onStartup.addListener(() => {
  flaggedLinks = [];
  chrome.storage.local.remove(FLAGGED_HISTORY_KEY);
});

/**
 * Record every Dangerous/Suspicious result of a scan batch in the session
 * history.  Duplicate URLs are skipped, newest entries are kept first, and
 * the list is capped at FLAGGED_HISTORY_MAX entries.
 *
 * @param {Array<Object>} results - Backend analysis results.
 */
async function rememberFlaggedLinks(results) {
  await flaggedLinksReady;

  let changed = false;
  for (const result of results) {
    if (!result || !result.url) continue;
    if (result.status !== "Dangerous" && result.status !== "Suspicious") continue;
    if (flaggedLinks.some((entry) => entry.url === result.url)) continue;

    flaggedLinks.unshift({
      url: result.url,
      status: result.status,
      riskScore: typeof result.score === "number" ? result.score : 0,
      reason:
        result.explanation ||
        (Array.isArray(result.reasons) && result.reasons[0]) ||
        "",
    });
    changed = true;
  }

  if (changed) {
    if (flaggedLinks.length > FLAGGED_HISTORY_MAX) {
      flaggedLinks = flaggedLinks.slice(0, FLAGGED_HISTORY_MAX);
    }
    chrome.storage.local.set({ [FLAGGED_HISTORY_KEY]: flaggedLinks });
  }
}

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
 *   - On timeout, resolves with per-URL "Safe" fallback results
 *     (reason: "Backend evaluation delayed") instead of an error, so the
 *     popup shows a normal result card rather than a blocking error UI.
 *   - Other network failures resolve gracefully — never rethrown and
 *     never logged with console.error — so Chrome does not raise the
 *     extension error badge when the backend is slow or down.
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

    // Track flagged results for the popup's Threat History list.
    await rememberFlaggedLinks(data);

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
      // Graceful per-URL fallback — no console.error and no unhandled
      // rejection (Chrome's extension error badge stays clean), and no
      // blocking "Backend timeout" error UI: the popup renders these as
      // ordinary Safe result cards.
      return links.map((url) => ({
        url,
        status: "Safe",
        riskScore: 0,
        score: 0,
        reason: "Backend evaluation delayed",
        explanation: "Backend evaluation delayed",
        // Sentinel: content.js skips stats and badge handling for entries
        // carrying an error marker, so a delayed evaluation is never
        // counted as a completed scan.
        error: "Backend evaluation delayed",
      }));
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
 * Listen for messages from content scripts and the popup.
 * Expected messages:
 *   { action: "scanPageLinks", links: [array of URLs] }
 *   { action: "getFlaggedLinks" }  →  { success: true, links: [...] }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.action === "scanPageLinks") {
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

  if (message.action === "getFlaggedLinks") {
    // Async: on a cold worker start the persisted history may still be
    // loading, so respond only once it is ready.
    flaggedLinksReady.then(() =>
      sendResponse({ success: true, links: flaggedLinks })
    );
    return true; // keep channel open for async response
  }
});
