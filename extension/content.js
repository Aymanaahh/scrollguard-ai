/**
 * ScrollGuard AI – Content Script
 *
 * Real-time <a> tag scanner for Single Page Applications (SPAs).
 *
 * On page load every existing <a> element is extracted via
 * document.querySelectorAll('a') and its href sent to the FastAPI backend
 * through background.js.  A MutationObserver then watches for dynamically
 * added <a> nodes (infinite-scroll feeds, AJAX inserts, etc.) and does the
 * same for each new link.
 *
 * When the backend returns "Dangerous" or "Suspicious" the offending <a>
 * tag is visually marked inline:
 *
 *   Dangerous  → thick red border    + 🚨 icon next to the link
 *   Suspicious → thick yellow border + ⚠️ icon next to the link
 *
 * A URL deduplication Set prevents the same href from being sent to the
 * backend more than once.
 */

(function () {
  "use strict";

  // ── Deduplication ──────────────────────────────────────────────────────────

  /**
   * Set of href strings already sent to the backend.  Prevents spamming
   * the API when the same URL appears in multiple feed posts.
   */
  const scannedUrls = new Set();

  /**
   * WeakSet of <a> elements already processed.  WeakSet is used so that
   * elements removed from the DOM are automatically garbage-collected.
   */
  const processedAnchors = new WeakSet();

  // ── Background service-worker communication ───────────────────────────────

  /**
   * Send an href + link text to background.js for AI analysis.
   * Returns the backend JSON response, or null if the service worker is
   * unreachable (extension context invalidated, backend offline, timeout).
   *
   * @param {string} href     The full href extracted from the <a> tag.
   * @param {string} linkText The visible text of the link (truncated).
   * @returns {Promise<Object|null>}
   */
  async function analyzeViaBackground(href, linkText) {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "analyzeUrl",
        url: href,
        text: linkText,
      });
      return result || null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Wrap analyzeViaBackground in a 6-second timeout so a slow or offline
   * backend never blocks the scan loop.
   *
   * @param {string} href
   * @param {string} linkText
   * @returns {Promise<Object|null>}
   */
  async function sendLinkForAnalysis(href, linkText) {
    try {
      return await Promise.race([
        analyzeViaBackground(href, linkText),
        new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, 6000);
        }),
      ]);
    } catch (_err) {
      return null;
    }
  }

  // ── Link filtering ─────────────────────────────────────────────────────────

  /**
   * Decide whether a link's href is worth sending to the backend.
   *
   * Rejects:
   *   - empty / missing href
   *   - non-HTTP(S) schemes (javascript:, data:, mailto:, tel:, #, blob:, file:)
   *   - navigation stubs ("#", "!", "/", "?")
   *   - same-origin links (internal SPA navigation, profile pages, etc.)
   */
  function isValidExternalLink(href) {
    if (!href) return false;

    var trimmed = href.trim();
    if (!trimmed) return false;

    // Reject non-HTTP schemes
    if (/^(javascript|data|mailto|tel|#|blob|file):/i.test(trimmed)) {
      return false;
    }

    // Reject SPA navigation stubs
    if (/^[#!\/?]?$/.test(trimmed)) return false;

    // Must be parseable as a URL
    var parsed;
    try {
      parsed = new URL(trimmed, window.location.href);
    } catch (_err) {
      return false;
    }

    // Only http: and https:
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // Same-origin → internal navigation
    if (parsed.hostname === window.location.hostname) return false;

    return true;
  }

  // ── Inline visual marking ──────────────────────────────────────────────────

  /**
   * Visually mark a flagged <a> element inline in the DOM.
   *
   *   Dangerous  → thick red border (3px solid #dc2626) + 🚨 icon
   *   Suspicious → thick yellow border (3px solid #eab308) + ⚠️ icon
   *
   * Idempotent: the data-scrollguard-marked attribute prevents double-marking.
   *
   * @param {HTMLAnchorElement} linkEl  The <a> element to mark.
   * @param {string}            status  "Dangerous" or "Suspicious".
   */
  function markDangerousLink(linkEl, status) {
    // Idempotency guard
    if (linkEl.dataset.scrollguardMarked) return;
    linkEl.dataset.scrollguardMarked = "true";

    var isDangerous = status === "Dangerous";

    // -- Thick coloured border + subtle tinted background on the link
    linkEl.style.border = isDangerous
      ? "3px solid #dc2626"
      : "3px solid #eab308";
    linkEl.style.borderRadius = "4px";
    linkEl.style.backgroundColor = isDangerous
      ? "rgba(220, 38, 38, 0.08)"
      : "rgba(234, 179, 8, 0.08)";
    linkEl.style.padding = "2px 4px";

    // -- Warning icon injected immediately after the link
    var badge = document.createElement("span");
    badge.className = "__scrollguard_link_badge__";
    badge.setAttribute("aria-label", "ScrollGuard: " + status + " link");
    badge.textContent = isDangerous ? " 🚨" : " ⚠️";

    Object.assign(badge.style, {
      display: "inline-block",
      fontSize: "13px",
      fontWeight: "700",
      fontFamily:
        "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
      marginLeft: "4px",
      verticalAlign: "middle",
      lineHeight: "1",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
    });

    linkEl.insertAdjacentElement("afterend", badge);
  }

  // ── Shared link processing pipeline ────────────────────────────────────────

  /**
   * Core processing for a single <a> element.  Called by both the initial
   * querySelectorAll scan and the MutationObserver callback.
   *
   * 1. Skip if already processed (WeakSet guard).
   * 2. Extract and validate the href.
   * 3. Skip if the URL was already sent to the backend (Set guard).
   * 4. Fire-and-forget the analysis request.
   * 5. On Dangerous or Suspicious → mark the link inline.
   *
   * @param {HTMLAnchorElement} anchor
   */
  function processAnchor(anchor) {
    // 1. Element-level dedup
    if (processedAnchors.has(anchor)) return;
    processedAnchors.add(anchor);

    // 2. Validate href
    var href = anchor.href;
    if (!isValidExternalLink(href)) return;

    // 3. URL-level dedup
    if (scannedUrls.has(href)) return;
    scannedUrls.add(href);

    // 4. Extract visible link text (capped at 500 chars)
    var linkText =
      (anchor.innerText || anchor.textContent || "").trim().substring(0, 500);

    // 5. Fire-and-forget analysis
    sendLinkForAnalysis(href, linkText).then(function (result) {
      if (!result || result.error) return;

      // Strict status check — only Dangerous or Suspicious trigger marking
      if (result.status === "Dangerous" || result.status === "Suspicious") {
        // The element may have been removed from the DOM while the backend
        // was responding; guard with isConnected.
        if (anchor.isConnected) {
          markDangerousLink(anchor, result.status);
        }
      }
    });
  }

  // ── Initial scan (page load) ───────────────────────────────────────────────

  /**
   * On load, use document.querySelectorAll('a') to find every existing link
   * on the page and send its href to the backend via background.js.
   */
  function scanExistingLinks() {
    var anchors = document.querySelectorAll("a");
    for (var i = 0; i < anchors.length; i++) {
      processAnchor(anchors[i]);
    }
  }

  // ── Dynamic scan (MutationObserver) ────────────────────────────────────────

  /**
   * MutationObserver callback: when new nodes are added to the DOM (e.g.
   * scrolling a social-media feed), extract every <a> tag from the new
   * subtree and process it.
   */
  function onMutations(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var addedNodes = mutations[m].addedNodes;
      for (var n = 0; n < addedNodes.length; n++) {
        var node = addedNodes[n];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // If the added node IS an <a>, process it directly.
        // Otherwise querySelectorAll for <a> descendants.
        if (node.tagName === "A") {
          processAnchor(node);
        } else if (node.querySelectorAll) {
          var anchors = node.querySelectorAll("a[href]");
          for (var a = 0; a < anchors.length; a++) {
            processAnchor(anchors[a]);
          }
        }
      }
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function init() {
    // Step 1: scan every <a> already present in the DOM
    scanExistingLinks();

    // Step 2: watch for dynamically added <a> tags
    //   childList → fires on node insertions
    //   subtree   → watches the entire tree, not just <body>'s direct children
    var observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Run when the DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
