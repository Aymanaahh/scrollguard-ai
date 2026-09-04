/**
 * ScrollGuard AI – Popup Script
 *
 * Displays the auto-scan status dashboard and live statistics.
 * Also provides a manual "Scan Active Tab" fallback button that sends
 * the current tab URL to the backend for on-demand analysis.
 */

document.addEventListener("DOMContentLoaded", () => {
  const urlBox = document.getElementById("currentUrl");
  const scanBtn = document.getElementById("scanBtn");
  const resultsDiv = document.getElementById("results");
  const statScanned = document.getElementById("statScanned");
  const statFlagged = document.getElementById("statFlagged");
  const statStatus = document.getElementById("statStatus");

  // ── Display the active tab URL ──────────────────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url) {
      urlBox.textContent = tab.url;
    } else {
      urlBox.textContent = "Unable to read URL (browser internal page)";
    }
  });

  // ── Stats display (single source for storage load + live updates) ────
  function updateStats(scanned, flagged) {
    statScanned.textContent = scanned;
    statFlagged.textContent = flagged;
    statStatus.textContent = scanned > 0 ? "Active" : "Waiting";
  }

  // Initial values from chrome.storage (persisted by content.js)
  chrome.storage.local.get(
    ["sg_linksScanned", "sg_linksFlagged"],
    (data) => updateStats(data.sg_linksScanned || 0, data.sg_linksFlagged || 0)
  );

  // Live updates broadcast by content.js after every scan batch
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "updateStats") {
      updateStats(message.scanned || 0, message.flagged || 0);
    }
  });

  // ── Manual "Scan Active Tab" fallback ──────────────────────────────────
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
    scanBtn.textContent = "Analyzing\u2026";
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
      scanBtn.textContent = "Scan Active Tab";
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────

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
    wrap.appendChild(document.createTextNode("Scanning\u2026"));
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
      reasons.textContent = result.reasons.join(" \u00B7 ");
      card.appendChild(reasons);
    }

    return card;
  }
});
