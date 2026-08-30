/**
 * ScrollGuard AI – Content Script
 *
 * Zero-click, real-time link scanner for SPAs and static pages.
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
 * tag is visually marked inline with an interactive, clickable badge that
 * opens a detail modal.
 *
 *   Dangerous  → red outline + 🚨 [DANGEROUS SCAN] badge (red bg, white text)
 *   Suspicious → amber outline + ⚠️ [SUSPICIOUS SCAN] badge (amber bg, dark text)
 *
 * All injected CSS classes are prefixed with "sg-ai-" to prevent host-page
 * stylesheet collisions.
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

  // ── Interactive explanation modal ──────────────────────────────────────────

  /**
   * Inject a full-screen overlay modal showing the AI analysis details
   * for a flagged link.  The modal includes:
   *   - Threat level header with warning icon
   *   - Scanned URL
   *   - Risk score
   *   - AI explanation
   *   - "Close / Stay Safe" button (dismisses modal)
   *   - "Proceed Anyway" button (opens URL in new tab)
   *
   * All CSS classes prefixed with "sg-ai-" for style isolation.
   */
  function showModal(data) {
    // Remove any existing modal first
    const existing = document.querySelector(".sg-ai-modal-overlay");
    if (existing) existing.remove();

    const isDangerous = data.status === "Dangerous";

    // ── Overlay backdrop ──
    const overlay = document.createElement("div");
    overlay.className = "sg-ai-modal-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      background: "rgba(0, 0, 0, 0.55)",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    });

    // ── Modal container ──
    const modal = document.createElement("div");
    modal.className = "sg-ai-modal";
    Object.assign(modal.style, {
      background: "#ffffff",
      borderRadius: "12px",
      width: "420px",
      maxWidth: "90vw",
      maxHeight: "80vh",
      overflow: "auto",
      boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
      border: isDangerous ? "3px solid #dc2626" : "3px solid #d97706",
    });

    // ── Header ──
    const header = document.createElement("div");
    header.className = "sg-ai-modal-header";
    Object.assign(header.style, {
      background: isDangerous
        ? "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)"
        : "linear-gradient(135deg, #92400e 0%, #d97706 100%)",
      color: "#ffffff",
      padding: "16px 20px",
      borderRadius: "9px 9px 0 0",
      display: "flex",
      alignItems: "center",
      gap: "10px",
    });

    const icon = document.createElement("span");
    icon.className = "sg-ai-modal-icon";
    icon.textContent = isDangerous ? "🚨" : "⚠️";
    Object.assign(icon.style, { fontSize: "24px", lineHeight: "1" });
    header.appendChild(icon);

    const titleWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "sg-ai-modal-title";
    title.textContent = isDangerous ? "DANGEROUS" : "SUSPICIOUS";
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "800",
      letterSpacing: "1px",
    });

    const subtitle = document.createElement("div");
    subtitle.className = "sg-ai-modal-subtitle";
    subtitle.textContent = "ScrollGuard AI Threat Detection";
    Object.assign(subtitle.style, {
      fontSize: "11px",
      opacity: "0.8",
      marginTop: "2px",
    });

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);
    modal.appendChild(header);

    // ── Body ──
    const body = document.createElement("div");
    body.className = "sg-ai-modal-body";
    Object.assign(body.style, { padding: "20px" });

    // URL field
    body.appendChild(buildModalField("Scanned URL", data.url, {
      wordBreak: "break-all",
      color: "#1e40af",
      fontSize: "12px",
    }));

    // Risk score
    body.appendChild(buildModalField("Risk Score", data.score + " / 100", {
      fontWeight: "700",
      fontSize: "18px",
      color: isDangerous ? "#dc2626" : "#d97706",
    }));

    // AI explanation
    body.appendChild(
      buildModalField("AI Explanation", data.explanation || "No detailed explanation available.")
    );

    // Reasons list
    if (Array.isArray(data.reasons) && data.reasons.length > 0) {
      const reasonsLabel = document.createElement("div");
      Object.assign(reasonsLabel.style, {
        fontSize: "11px",
        fontWeight: "700",
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: "6px",
      });
      reasonsLabel.textContent = "Flagged Reasons";

      const reasonsList = document.createElement("ul");
      Object.assign(reasonsList.style, {
        margin: "0 0 16px 0",
        padding: "0 0 0 18px",
        fontSize: "12px",
        color: "#475569",
        lineHeight: "1.5",
      });

      for (const reason of data.reasons) {
        const li = document.createElement("li");
        li.textContent = reason;
        reasonsList.appendChild(li);
      }

      body.appendChild(reasonsLabel);
      body.appendChild(reasonsList);
    }

    modal.appendChild(body);

    // ── Action buttons ──
    const actions = document.createElement("div");
    actions.className = "sg-ai-modal-actions";
    Object.assign(actions.style, {
      padding: "0 20px 20px",
      display: "flex",
      gap: "10px",
    });

    // "Close / Stay Safe" button
    const staySafeBtn = document.createElement("button");
    staySafeBtn.className = "sg-ai-btn-stay-safe";
    staySafeBtn.textContent = "Close / Stay Safe";
    Object.assign(staySafeBtn.style, {
      flex: "1",
      padding: "10px 16px",
      background: "#2563eb",
      color: "#ffffff",
      border: "none",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "inherit",
    });
    staySafeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    });

    // "Proceed Anyway" button
    const proceedBtn = document.createElement("button");
    proceedBtn.className = "sg-ai-btn-proceed";
    proceedBtn.textContent = "Proceed Anyway";
    Object.assign(proceedBtn.style, {
      flex: "1",
      padding: "10px 16px",
      background: "#f1f5f9",
      color: "#64748b",
      border: "1px solid #cbd5e1",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "inherit",
    });
    proceedBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(data.url, "_blank", "noopener,noreferrer");
      overlay.remove();
    });

    actions.appendChild(staySafeBtn);
    actions.appendChild(proceedBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);

    // Close on backdrop click (outside modal)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        e.preventDefault();
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  /**
   * Build a labelled field row for the modal body.
   */
  function buildModalField(label, value, valueStyleOverrides) {
    const wrap = document.createElement("div");
    wrap.className = "sg-ai-modal-field";
    wrap.style.marginBottom = "16px";

    const lbl = document.createElement("div");
    lbl.className = "sg-ai-modal-field-label";
    Object.assign(lbl.style, {
      fontSize: "11px",
      fontWeight: "700",
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom: "4px",
    });
    lbl.textContent = label;

    const val = document.createElement("div");
    val.className = "sg-ai-modal-field-value";
    Object.assign(val.style, {
      fontSize: "13px",
      color: "#1e293b",
      lineHeight: "1.5",
    });
    if (valueStyleOverrides) {
      Object.assign(val.style, valueStyleOverrides);
    }
    val.textContent = value;

    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return wrap;
  }

  // ── Inline visual marking ──────────────────────────────────────────────────

  /**
   * Visually mark a flagged <a> element inline in the DOM.
   *
   *   Dangerous  → red outline + 🚨 [DANGEROUS SCAN] badge (red bg, white text)
   *   Suspicious → amber outline + ⚠️ [SUSPICIOUS SCAN] badge (amber bg, dark text)
   *
   * Badges are clickable and open the detail modal.  Click events on badges
   * are intercepted with preventDefault + stopPropagation so the user is
   * never navigated to the dangerous URL accidentally.
   *
   * Idempotent via data-scrollguard-marked attribute.
   *
   * @param {HTMLAnchorElement} linkEl
   * @param {Object} result - Full backend result for this URL.
   */
  function markLink(linkEl, result) {
    if (linkEl.dataset.scrollguardMarked) return;
    linkEl.dataset.scrollguardMarked = "true";

    const status = result.status;
    const score = result.score || 0;
    const isDangerous = status === "Dangerous";

    // ── Link border + background tint ──
    linkEl.style.outline = isDangerous
      ? "3px solid #dc2626"
      : "3px solid #d97706";
    linkEl.style.outlineOffset = "2px";
    linkEl.style.borderRadius = "4px";
    linkEl.style.backgroundColor = isDangerous
      ? "rgba(220, 38, 38, 0.08)"
      : "rgba(217, 119, 6, 0.08)";

    // ── Inline badge ──
    const badge = document.createElement("span");
    badge.className = "sg-ai-badge";
    badge.textContent = isDangerous
      ? " \uD83D\uDEA8 [DANGEROUS SCAN]"
      : " \u26A0\uFE0F [SUSPICIOUS SCAN]";
    badge.title = "ScrollGuard: Click for details (Risk " + score + "/100)";

    Object.assign(badge.style, {
      display: "inline-block",
      fontSize: "11px",
      fontWeight: "700",
      fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
      marginLeft: "4px",
      marginRight: "2px",
      padding: "2px 8px",
      borderRadius: "4px",
      verticalAlign: "middle",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      cursor: "pointer",
      userSelect: "none",
      background: isDangerous ? "#dc2626" : "#fbbf24",
      color: isDangerous ? "#ffffff" : "#1e293b",
      boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    });

    // ── Click event guard: prevent navigation + open modal ──
    badge.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      showModal({
        status: status,
        url: result.url,
        score: score,
        explanation: result.explanation,
        reasons: result.reasons,
      });
    });

    linkEl.insertAdjacentElement("afterend", badge);
  }

  // ── Scan pipeline ──────────────────────────────────────────────────────────

  /** Running counters persisted to chrome.storage for the popup. */
  let totalScanned = 0;
  let totalFlagged = 0;

  /**
   * Persist scan statistics to chrome.storage.local so the popup can
   * display them, and broadcast a live update to any open popup.
   */
  function persistStats() {
    chrome.storage.local.set({
      sg_linksScanned: totalScanned,
      sg_linksFlagged: totalFlagged,
    });
    // Best-effort broadcast to open popup
    try {
      chrome.runtime.sendMessage({
        action: "updateStats",
        scanned: totalScanned,
        flagged: totalFlagged,
      });
    } catch (_e) { /* popup may not be open */ }
  }

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

      totalScanned++;

      if (result.status === "Dangerous" || result.status === "Suspicious") {
        totalFlagged++;
        if (element.isConnected) {
          markLink(element, result);
        }
      }
    }

    persistStats();
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
