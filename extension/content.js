/**
 * ScrollGuard AI – Content Script
 *
 * Real-time link scanner for SPAs and static pages.
 *
 * On load, extracts every <a> element via querySelectorAll and sends the
 * hrefs in a single batch to the background service worker, which forwards
 * them to the FastAPI backend for AI analysis.
 *
 * A MutationObserver then watches document.body for dynamically inserted
 * <a> nodes (infinite scroll, AJAX inserts, etc.) and dispatches only the
 * new, unseen links.
 *
 * When the backend returns "Dangerous" or "Suspicious" the offending <a>
 * tag is visually marked inline:
 *   Dangerous  → thick red border + 🚨 badge
 *   Suspicious → thick amber border + ⚠️ badge
 */

(function () {
  "use strict";

  // ── Deduplication ──────────────────────────────────────────────────────────

  /** Set of href strings already sent to the backend. */
  const scannedUrls = new Set();

  /** WeakSet of <a> elements already processed (GC-safe). */
  const processedAnchors = new WeakSet();

  // ── Link extraction & validation ───────────────────────────────────────────

  /**
   * Decide whether an href is worth sending to the backend.
   *
   * Rejects empty, javascript:, data:, mailto:, tel:, #anchor,
   * navigation stubs, and same-origin links.
   */
  function isValidExternalLink(href) {
    if (!href) return false;

    const trimmed = href.trim();
    if (!trimmed) return false;

    // Reject non-HTTP schemes
    if (/^(javascript|data|mailto|tel|#|blob|file):/i.test(trimmed)) {
      return false;
    }

    // Reject SPA navigation stubs
    if (/^[#!\/?]?$/.test(trimmed)) return false;

    // Must be parseable as a URL
    let parsed;
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

  /**
   * Collect all <a> elements in the given root whose href passes validation
   * and that haven't been processed yet.  Returns a deduplicated array of
   * { element, href } objects (one per unique URL — subsequent duplicates
   * are skipped from the batch but still marked via processedAnchors).
   */
  function collectNewLinks(root) {
    const anchors =
      root.tagName === "A"
        ? [root]
        : Array.from(root.querySelectorAll ? root.querySelectorAll("a[href]") : []);

    const batch = [];

    for (const anchor of anchors) {
      if (processedAnchors.has(anchor)) continue;
      processedAnchors.add(anchor);

      const href = anchor.href;
      if (!isValidExternalLink(href)) continue;

      // URL-level dedup: only add to batch if not yet scanned
      if (!scannedUrls.has(href)) {
        scannedUrls.add(href);
        batch.push({ element: anchor, href });
      }
    }

    return batch;
  }

  // ── Background communication ───────────────────────────────────────────────

  /**
   * Send a batch of URLs to background.js via chrome.runtime.sendMessage.
   * Returns the backend response array, or null on error / timeout.
   *
   * @param {string[]} hrefs
   * @returns {Promise<Array|null>}
   */
  async function sendToBackground(hrefs) {
    try {
      const result = await Promise.race([
        chrome.runtime.sendMessage({
          action: "scanPageLinks",
          links: hrefs,
        }),
        new Promise((resolve) =>
          setTimeout(() => resolve(null), 30000)
        ),
      ]);
      return result || null;
    } catch (_err) {
      return null;
    }
  }

  // ── Inline visual marking ──────────────────────────────────────────────────

  /**
   * Visually mark a flagged <a> element inline in the DOM.
   *
   *   Dangerous  → 3px solid red border + 🚨 badge
   *   Suspicious → 3px solid amber border + ⚠️ badge
   *
   * Idempotent via data-scrollguard-marked attribute.
   */
  function markLink(linkEl, status, score) {
    if (linkEl.dataset.scrollguardMarked) return;
    linkEl.dataset.scrollguardMarked = "true";

    const isDangerous = status === "Dangerous";

    // Border + background tint
    linkEl.style.outline = isDangerous
      ? "3px solid #dc2626"
      : "3px solid #d97706";
    linkEl.style.outlineOffset = "2px";
    linkEl.style.borderRadius = "4px";
    linkEl.style.backgroundColor = isDangerous
      ? "rgba(220, 38, 38, 0.08)"
      : "rgba(217, 119, 6, 0.08)";

    // Warning badge
    const badge = document.createElement("span");
    badge.className = "__scrollguard_badge__";
    badge.textContent = isDangerous ? " 🚨" : " ⚠️";
    badge.title = "ScrollGuard: " + status + " (Risk " + score + "/100)";

    Object.assign(badge.style, {
      display: "inline-block",
      fontSize: "12px",
      fontWeight: "700",
      fontFamily:
        "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
      marginLeft: "4px",
      verticalAlign: "middle",
      lineHeight: "1",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
    });

    linkEl.insertAdjacentElement("afterend", badge);
  }

  // ── Scan pipeline ──────────────────────────────────────────────────────────

  /**
   * Collect new links from the given root, send them to the backend in a
   * single batch, and apply inline markings for any flagged results.
   */
  async function scanLinks(root) {
    const newLinks = collectNewLinks(root || document.body);
    if (newLinks.length === 0) return;

    const hrefs = newLinks.map((l) => l.href);
    const results = await sendToBackground(hrefs);

    if (!Array.isArray(results)) return;

    // Build a lookup map: href → result
    const resultMap = new Map();
    for (const r of results) {
      if (r && r.url) resultMap.set(r.url, r);
    }

    for (const { element, href } of newLinks) {
      const result = resultMap.get(href);
      if (!result || result.error) continue;

      if (result.status === "Dangerous" || result.status === "Suspicious") {
        if (element.isConnected) {
          markLink(element, result.status, result.score || 0);
        }
      }
    }
  }

  // ── MutationObserver ───────────────────────────────────────────────────────

  /**
   * Watches for newly added DOM nodes and scans any <a> tags they contain.
   * Debounced at 300 ms to coalesce bursts of DOM mutations (e.g. when a
   * social-media feed inserts many posts at once).
   */
  let mutationTimer = null;
  const pendingRoots = new Set();

  function onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        pendingRoots.add(node);
      }
    }

    if (!mutationTimer) {
      mutationTimer = setTimeout(() => {
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        mutationTimer = null;

        for (const root of roots) {
          scanLinks(root);
        }
      }, 300);
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function init() {
    // 1. Initial scan: every <a> already present in the DOM
    scanLinks(document.body);

    // 2. Dynamic scan: watch for newly inserted <a> tags
    const observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
