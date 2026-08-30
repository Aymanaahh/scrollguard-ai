/**
 * ScrollGuard AI – Popup Script
 *
 * Allows the user to manually trigger a scan of the current page URL.
 * Sends the URL to background.js → FastAPI backend and renders the
 * results into the popup UI.
 */

document.addEventListener("DOMContentLoaded", () => {
  const urlBox = document.getElementById("currentUrl");
  const scanBtn = document.getElementById("scanBtn");
  const resultsDiv = document.getElementById("results");

  // Display the active tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    urlBox.textContent = tab && tab.url ? tab.url : "Unable to read URL";
  });

  // Scan button click handler
  scanBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.url) {
      showError("No active tab URL found.");
      return;
    }

    // Disable button + show spinner
    scanBtn.disabled = true;
    scanBtn.textContent = "Analyzing…";
    resultsDiv.replaceChildren(buildSpinner());

    try {
      const results = await chrome.runtime.sendMessage({
        action: "scanPageLinks",
        links: [tab.url],
      });

      resultsDiv.replaceChildren();

      if (!results || results.error) {
        showError(
          results?.error || "Could not reach the backend. Is Uvicorn running?"
        );
        return;
      }

      if (!Array.isArray(results) || results.length === 0) {
        showError("No results returned from the backend.");
        return;
      }

      for (const r of results) {
        resultsDiv.appendChild(buildResultCard(r));
      }
    } catch (err) {
      showError("Extension error: " + err.message);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan Current Page";
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function showError(message) {
    resultsDiv.replaceChildren();
    const div = document.createElement("div");
    div.className = "error-msg";
    div.textContent = message;
    resultsDiv.appendChild(div);
  }

  function buildSpinner() {
    const wrap = document.createElement("div");
    wrap.className = "spinner-wrap";

    const spinner = document.createElement("div");
    spinner.className = "spinner";
    wrap.appendChild(spinner);

    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(document.createTextNode("Scanning…"));
    return wrap;
  }

  function buildResultCard(result) {
    const card = document.createElement("div");
    card.className = "result-card";

    // URL line
    const urlLine = document.createElement("div");
    urlLine.className = "result-url";
    urlLine.textContent = result.url || "(unknown)";
    card.appendChild(urlLine);

    // Status row
    const statusRow = document.createElement("div");
    statusRow.className = "status-row";

    const badge = document.createElement("span");
    const status = (result.status || "Error").toLowerCase();
    badge.className = "status-badge " + status;
    badge.textContent = result.status || "Error";
    statusRow.appendChild(badge);

    if (typeof result.score === "number") {
      const score = document.createElement("span");
      score.className = "score-label";
      score.textContent = "Risk " + result.score + " / 100";
      statusRow.appendChild(score);
    }

    card.appendChild(statusRow);

    // Explanation
    if (result.explanation) {
      const expl = document.createElement("div");
      expl.className = "explanation";
      expl.textContent = result.explanation;
      card.appendChild(expl);
    }

    // Reasons
    if (Array.isArray(result.reasons) && result.reasons.length > 0) {
      const reasons = document.createElement("div");
      reasons.className = "reasons";
      reasons.textContent = result.reasons.join(" · ");
      card.appendChild(reasons);
    }

    return card;
  }
});
