/**
 * ScrollGuard AI – Popup Script
 *
 * Displays the auto-scan status dashboard and live statistics.
 * Clicking the FLAGGED stat card toggles the "Flagged Threat History"
 * list of Dangerous/Suspicious links recorded by background.js during
 * this browsing session.
 * Also provides a manual "Scan Active Tab" fallback button that sends
 * the current tab URL to the backend for on-demand analysis.
 *
 * Both the live stats and the manual scan strip tracking query parameters
 * (fbclid, gclid, utm_*, …) before any URL reaches the backend, and the
 * status chip flips to "Active" as soon as a scan is dispatched — so a
 * slow or unreachable backend never leaves the UI stuck on "Waiting".
 */

document.addEventListener("DOMContentLoaded", () => {
  const urlBox = document.getElementById("currentUrl");
  const scanBtn = document.getElementById("scanBtn");
  const resultsDiv = document.getElementById("results");
  const statScanned = document.getElementById("statScanned");
  const statFlagged = document.getElementById("statFlagged");
  const statStatus = document.getElementById("statStatus");

  // Flagged Threat History (toggled by the FLAGGED stat card)
  const flaggedToggle = document.getElementById("flaggedToggle");
  const flaggedHistory = document.getElementById("flaggedHistory");
  const flaggedList = document.getElementById("flaggedList");
  const flaggedCount = document.getElementById("flaggedCount");

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
  function updateStats(scanned, flagged, attempted) {
    statScanned.textContent = scanned;
    statFlagged.textContent = flagged;
    // Status flips to "Active" as soon as any URL has been scanned OR
    // dispatched to the backend — so a timeout / network failure never
    // leaves the chip permanently stuck on "Waiting".
    statStatus.textContent = (scanned > 0 || attempted > 0) ? "Active" : "Waiting";
  }

  // Initial values from chrome.storage (persisted by content.js)
  chrome.storage.local.get(
    ["sg_linksScanned", "sg_linksFlagged", "sg_linksAttempted"],
    (data) => updateStats(
      data.sg_linksScanned || 0,
      data.sg_linksFlagged || 0,
      data.sg_linksAttempted || 0
    )
  );

  // Live updates broadcast by content.js after every scan batch
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "updateStats") {
      updateStats(message.scanned || 0, message.flagged || 0, message.attempted || 0);
      // Keep an open history list in sync with newly flagged links.
      if (!flaggedHistory.hasAttribute("hidden")) {
        loadFlaggedLinks();
      }
    }
  });

  // ── Flagged Threat History ─────────────────────────────────────────────
  //
  // Clicking the FLAGGED stat card toggles the session's flagged-link
  // list (maintained by background.js) open and closed.

  function toggleFlaggedHistory() {
    const willOpen = flaggedHistory.hasAttribute("hidden");
    if (willOpen) {
      flaggedHistory.removeAttribute("hidden");
      loadFlaggedLinks(); // always refresh on open
    } else {
      flaggedHistory.setAttribute("hidden", "");
    }
    flaggedToggle.classList.toggle("open", willOpen);
    flaggedToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  flaggedToggle.addEventListener("click", toggleFlaggedHistory);
  flaggedToggle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleFlaggedHistory();
    }
  });

  /** Fetch the flagged-link history from the background service worker. */
  async function loadFlaggedLinks() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getFlaggedLinks",
      });
      const links =
        response && response.success && Array.isArray(response.links)
          ? response.links
          : [];
      renderFlaggedList(links);
    } catch (_err) {
      renderFlaggedList([]);
    }
  }

  /** Render the history list, or the empty state when nothing is flagged. */
  function renderFlaggedList(links) {
    flaggedCount.textContent = String(links.length);
    flaggedList.replaceChildren();

    if (!links || links.length === 0) {
      const empty = document.createElement("div");
      empty.className = "flagged-empty";
      empty.textContent = "No threat links detected in this session.";
      flaggedList.appendChild(empty);
      return;
    }

    for (const link of links) {
      flaggedList.appendChild(buildFlaggedCard(link));
    }
  }

  /**
   * Build one dark-card row for a flagged link:
   * severity pill + risk score, truncated URL, AI explanation snippet.
   */
  function buildFlaggedCard(link) {
    const isDangerous = link.status === "Dangerous";
    const severity = isDangerous ? "dangerous" : "suspicious";

    const card = document.createElement("div");
    card.className = "flagged-card " + severity;

    const header = document.createElement("div");
    header.className = "flagged-card-header";

    const pill = document.createElement("span");
    pill.className = "flagged-pill " + severity;
    pill.textContent = isDangerous
      ? "\uD83D\uDEA8 Dangerous"
      : "\u26A0\uFE0F Suspicious";

    const score = document.createElement("span");
    score.className = "flagged-score";
    score.textContent = "Risk: " + (link.riskScore || 0) + "/100";

    header.appendChild(pill);
    header.appendChild(score);
    card.appendChild(header);

    const urlEl = document.createElement("div");
    urlEl.className = "flagged-url";
    urlEl.textContent = truncateUrl(link.url);
    urlEl.title = link.url || "";
    card.appendChild(urlEl);

    const reason = document.createElement("div");
    reason.className = "flagged-reason";
    reason.textContent = link.reason || "No explanation available.";
    card.appendChild(reason);

    return card;
  }

  /** Compact "domain/path" label for a URL (full URL on hover via title). */
  function truncateUrl(url) {
    const MAX_CHARS = 52;
    let text = String(url || "");
    try {
      const parsed = new URL(text);
      const domain = parsed.hostname.replace(/^www\./, "");
      text = domain + parsed.pathname + parsed.search;
    } catch (_err) {
      /* not a parseable URL — fall back to the raw string */
    }
    return text.length > MAX_CHARS
      ? text.slice(0, MAX_CHARS - 1) + "\u2026"
      : text;
  }

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
      // Strip tracking parameters (fbclid, utm_source, etc.) before sending
      // to the backend so the LLM receives the meaningful URL only.
      const cleanUrl = stripTrackingParams(tab.url);
      const results = await chrome.runtime.sendMessage({
        action: "scanPageLinks",
        links: [cleanUrl],
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
      // Belt-and-suspenders: guarantee the status chip resets to "Active"
      // after any manual scan attempt, regardless of backend success or
      // failure — so the UI never gets permanently stuck on "Waiting".
      statStatus.textContent = "Active";
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Query-string parameter names added by ad networks, social platforms, and
   * analytics SDKs.  Stripping them before sending URLs to the backend
   * shrinks payloads and keeps the scanned URL focused on its meaningful
   * origin + path.
   */
  const TRACKING_PARAMS = new Set([
    "fbclid", "gclid", "gclsrc", "msclkid", "twclid", "dclid",
    "mc_eid", "igshid", "li_fat_id",
    "utm_source", "utm_medium", "utm_campaign", "utm_term",
    "utm_content", "utm_id", "utm_source_platform", "utm_creative_format",
  ]);

  /**
   * Return a copy of `url` with all recognised tracking query parameters
   * removed.  Origin, path, hash, and non-tracking parameters are preserved.
   * If `url` cannot be parsed, it is returned unchanged.
   *
   * @param {string} url
   * @returns {string}
   */
  function stripTrackingParams(url) {
    let parsed;
    try { parsed = new URL(url); } catch (_err) { return url; }

    const kept = new URLSearchParams();
    for (const [key, value] of parsed.searchParams) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.append(key, value);
    }
    parsed.search = kept.toString();
    return parsed.toString();
  }

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
