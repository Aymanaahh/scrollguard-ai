/**
 * ScrollGuard AI – Background Service Worker
 *
 * Handles batch link analysis and messaging between content scripts and backend.
 * Acts as a proxy between the content script and the FastAPI backend so that
 * fetch requests are executed in the extension's privileged context, avoiding
 * CORS and Mixed Content restrictions that block content scripts and popups
 * running on HTTPS pages.
 */

const BACKEND_URL = "http://127.0.0.1:8000/scan_links";

/**
 * Send array of URLs to backend for AI analysis.
 * Returns JSON response or error object.
 */
async function analyzeLinksBatch(links) {
  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: links }),
    });

    if (!response.ok) {
      return { error: "Backend returned HTTP " + response.status };
    }

    return await response.json();
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Listen for messages from content scripts.
 * Expected message: { action: "scanPageLinks", links: [array of URLs] }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scanPageLinks") {
    analyzeLinksBatch(message.links).then(sendResponse);
    return true; // keep channel open for async response
  }
});
