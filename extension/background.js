/**
 * ScrollGuard AI – Background Service Worker
 *
 * Acts as a proxy between the content script and the FastAPI backend so that
 * fetch requests are executed in the extension's privileged context, avoiding
 * CORS and Mixed Content restrictions that block content scripts and popups
 * running on HTTPS pages.
 */

const BACKEND_URL = "http://127.0.0.1:8000/analyze";

/**
 * Send URL + page text to the ScrollGuard backend for AI analysis.
 * Returns the JSON response or an error object.
 */
async function analyzeWithBackend(url, text) {
  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        text: text,
        platform: "Browser Extension",
      }),
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
 * Listen for messages from content scripts (and popup).
 * Expected message shape: { action: "analyzeUrl", url: string, text: string }
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "analyzeUrl") {
    analyzeWithBackend(message.url, message.text).then(sendResponse);
    // Return true to signal that sendResponse will be called asynchronously
    return true;
  }
});
