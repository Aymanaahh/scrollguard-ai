/**
 * ScrollGuard AI – Content Script
 *
 * Three-layer real-time protection:
 *
 *   1. PAGE-LEVEL SCAN  – on load, the current URL and visible text are
 *      checked against local heuristic indicators.  The page URL + title are
 *      also sent to the AI backend via the background service worker.
 *      If either layer flags the page, a fixed warning banner is injected
 *      at the top of the DOM.
 *
 *   2. SPA LINK SCRAPER – a MutationObserver watches document.body for
 *      dynamically inserted <a> tags (common in infinite-scroll feeds on
 *      Twitter / X, Facebook, LinkedIn, etc.).  Each new external link is
 *      sent to the backend for analysis; if flagged Dangerous or Suspicious
 *      the link is visually marked inline with a red border, tinted
 *      background, and a warning badge.
 *
 *   3. DEDUPLICATION    – a Set tracks every URL that has already been sent
 *      to the backend so the API is never spammed with duplicate requests.
 */

(function () {
  "use strict";

  // Prevent double-injection if the script runs more than once
  if (document.getElementById("__scrollguard_banner__")) return;

  // ── Scam indicator keyword lists ──────────────────────────────────────────

  const URL_INDICATORS = [
    // Suspicious TLDs often abused for phishing / scams
    ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".buzz",
    ".click", ".link", ".icu", ".cam",
    // URL-shortener patterns
    "bit.ly", "tinyurl", "shorturl", "t.co", "ow.ly",
    // Phishing-style path keywords
    "free-money", "free-crypto", "giveaway", "claim-now",
    "account-verify", "verify-urgent", "bank-account", "login-secure",
    "secure-update", "confirm-identity", "payment-required",
    "suspended-account", "unusual-activity",
    // Hyphen-heavy domains (common in phishing)
    /[a-z]+-[a-z]+-[a-z]+-[a-z]+\.(com|net|org|info|online|site)/i,
  ];

  const TEXT_INDICATORS = [
    // Prize / lottery scams
    /congratulations\s*!?\s*you\s*(won|have\s*won|are\s*the\s*winner)/i,
    /you\s*('ve\s*)?been\s*selected/i,
    /claim\s*(your|now|prize|reward)/i,
    /free\s*(money|cash|gift|bitcoin|crypto)/i,
    // Investment / crypto scams
    /double\s*your\s*(bitcoin|btc|crypto|investment|money)/i,
    /deposit\s*\d/i,
    /guaranteed\s*(profit|return|earnings)/i,
    /earn\s*\$\s*\d+\s*(per\s*(day|hour|week)|daily)/i,
    // Phishing / urgency
    /urgent\s*:\s*your\s*(bank|account|card)/i,
    /account\s*(will\s*be\s*)?suspended/i,
    /verify\s*(your\s*)?(credentials|identity|account|card)/i,
    /unusual\s*(login|activity|sign[- ]?in)/i,
    /confirm\s*your\s*(personal|banking|financial)\s*information/i,
    /your\s*(paypal|apple|google|microsoft)\s*account\s*(has\s*been|is)/i,
    // Pressure tactics
    /(act|respond)\s*(now|immediately|within\s*\d+\s*(hours|minutes))/i,
    /limited[\s-]*time\s*offer/i,
    /this\s*offer\s*(expires|ends)\s*(in|soon|today)/i,
    // Credential harvesting
    /enter\s*your\s*(password|ssn|social\s*security|card\s*number)/i,
    /update\s*your\s*(billing|payment|card)\s*information/i,
  ];

  // ── Detection helpers ─────────────────────────────────────────────────────

  /**
   * Check the URL string for known scam indicators.
   * Returns an array of matched indicator strings.
   */
  function checkUrl(url) {
    const matches = [];
    const lower = url.toLowerCase();

    for (const indicator of URL_INDICATORS) {
      if (indicator instanceof RegExp) {
        if (indicator.test(url)) matches.push(indicator.toString());
      } else if (lower.includes(indicator)) {
        matches.push(indicator);
      }
    }
    return matches;
  }

  /**
   * Check the visible page text for scam phrases.
   * Returns an array of matched indicator strings.
   */
  function checkText(text) {
    const matches = [];
    for (const pattern of TEXT_INDICATORS) {
      if (pattern.test(text)) matches.push(pattern.source);
    }
    return matches;
  }

  /**
   * Grab a truncated sample of the page's visible text for keyword scanning.
   */
  function getPageText(maxLength) {
    const body = document.body;
    if (!body) return "";
    const text = body.innerText || body.textContent || "";
    return text.substring(0, maxLength || 5000);
  }

  // ── Background service-worker communication ───────────────────────────────

  /**
   * Send a URL + text payload to background.js for AI-powered analysis.
   * Returns the backend JSON response, or null if the service worker is
   * unreachable (e.g. extension context invalidated, backend offline).
   *
   * Used for both page-level scans (url=pageUrl, text=pageTitle) and
   * individual link scans (url=href, text=linkText).
   */
  async function analyzeViaBackground(url, text) {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "analyzeUrl",
        url: url,
        text: text,
      });
      return result || null;
    } catch (_err) {
      // Service worker may not be ready; silently skip AI analysis
      return null;
    }
  }

  // ── Page-level banner injection ────────────────────────────────────────────

  /**
   * Determine a human-readable severity label from the combined results.
   */
  function resolveSeverity(urlHits, textHits, aiResult) {
    const aiStatus = aiResult && aiResult.status ? aiResult.status : null;
    if (aiStatus === "Dangerous") return "HIGH RISK";
    if (aiStatus === "Suspicious") return "SUSPICIOUS";

    const totalHits = urlHits.length + textHits.length;
    if (totalHits >= 5) return "HIGH RISK";
    if (totalHits >= 3) return "SUSPICIOUS";
    return "POTENTIAL THREAT";
  }

  /**
   * Build the detail sub-line summarizing what was found.
   */
  function buildDetail(urlHits, textHits, aiResult) {
    const parts = [];

    if (urlHits.length) {
      parts.push(
        "Suspicious URL pattern" + (urlHits.length > 1 ? "s" : "") + " found"
      );
    }
    if (textHits.length) {
      parts.push("Scam-related page content detected");
    }

    if (aiResult && !aiResult.error && aiResult.status) {
      const scoreText =
        typeof aiResult.risk_score === "number"
          ? " (AI risk score: " + aiResult.risk_score + "/100)"
          : "";
      parts.push("AI analysis: " + aiResult.status + scoreText);
    }

    return parts.join(" · ") + ". Proceed with extreme caution.";
  }

  /**
   * Build and inject the fixed warning banner into the page DOM.
   *
   * @param {string[]}    urlHits    Matched URL indicators (may be empty).
   * @param {string[]}    textHits   Matched text indicators (may be empty).
   * @param {Object|null} aiResult   Backend JSON response, or null.
   */
  function injectBanner(urlHits, textHits, aiResult) {
    const severityLabel = resolveSeverity(urlHits, textHits, aiResult);

    // -- Banner container
    const banner = document.createElement("div");
    banner.id = "__scrollguard_banner__";
    banner.setAttribute("role", "alert");
    banner.setAttribute("aria-live", "assertive");

    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      zIndex: "2147483647",
      background: "linear-gradient(135deg, #b91c1c 0%, #dc2626 40%, #ef4444 100%)",
      color: "#ffffff",
      fontFamily:
        "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 20px",
      boxSizing: "border-box",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
      borderBottom: "3px solid #7f1d1d",
    });

    // -- Left: icon + text
    const left = document.createElement("div");
    Object.assign(left.style, {
      display: "flex",
      alignItems: "center",
      gap: "14px",
      flex: "1",
    });

    // Warning icon (inline SVG – no external assets, built via DOM API)
    const iconWrap = document.createElement("span");
    Object.assign(iconWrap.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "40px",
      height: "40px",
      minWidth: "40px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.18)",
      fontSize: "22px",
    });

    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "#ffffff");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const triangle = document.createElementNS(SVG_NS, "path");
    triangle.setAttribute(
      "d",
      "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
    );
    const lineTop = document.createElementNS(SVG_NS, "line");
    lineTop.setAttribute("x1", "12"); lineTop.setAttribute("y1", "9");
    lineTop.setAttribute("x2", "12"); lineTop.setAttribute("y2", "13");
    const lineDot = document.createElementNS(SVG_NS, "line");
    lineDot.setAttribute("x1", "12");  lineDot.setAttribute("y1", "17");
    lineDot.setAttribute("x2", "12.01"); lineDot.setAttribute("y2", "17");

    svg.appendChild(triangle);
    svg.appendChild(lineTop);
    svg.appendChild(lineDot);
    iconWrap.appendChild(svg);

    // Text block
    const textBlock = document.createElement("div");

    const headline = document.createElement("div");
    Object.assign(headline.style, {
      fontSize: "15px",
      fontWeight: "700",
      letterSpacing: "0.5px",
      marginBottom: "3px",
    });
    headline.textContent = "🛡️ ScrollGuard AI — " + severityLabel + " Detected";

    const detail = document.createElement("div");
    Object.assign(detail.style, {
      fontSize: "12px",
      opacity: "0.92",
      lineHeight: "1.4",
    });
    detail.textContent = buildDetail(urlHits, textHits, aiResult);

    // Show AI explanation when available
    if (aiResult && !aiResult.error && aiResult.explanation) {
      const explLine = document.createElement("div");
      Object.assign(explLine.style, {
        fontSize: "11px",
        opacity: "0.82",
        lineHeight: "1.35",
        marginTop: "4px",
        fontStyle: "italic",
      });
      explLine.textContent = aiResult.explanation;
      textBlock.appendChild(headline);
      textBlock.appendChild(detail);
      textBlock.appendChild(explLine);
    } else {
      textBlock.appendChild(headline);
      textBlock.appendChild(detail);
    }

    left.appendChild(iconWrap);
    left.appendChild(textBlock);

    // -- Right: dismiss button
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "Dismiss";
    Object.assign(dismissBtn.style, {
      background: "rgba(255,255,255,0.2)",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,0.45)",
      borderRadius: "6px",
      padding: "8px 18px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      marginLeft: "16px",
      flexShrink: "0",
      transition: "background 0.2s",
      fontFamily: "inherit",
      lineHeight: "1",
    });
    dismissBtn.addEventListener("mouseenter", function () {
      this.style.background = "rgba(255,255,255,0.35)";
    });
    dismissBtn.addEventListener("mouseleave", function () {
      this.style.background = "rgba(255,255,255,0.2)";
    });
    dismissBtn.addEventListener("click", function () {
      banner.remove();
    });

    // -- Assemble
    banner.appendChild(left);
    banner.appendChild(dismissBtn);

    // Inject as the very first child of <body>
    document.body.prepend(banner);

    // Push page content down so the banner doesn't overlap content
    const bannerHeight = banner.offsetHeight;
    const originalMargin =
      parseInt(getComputedStyle(document.body).marginTop, 10) || 0;
    document.body.style.marginTop = originalMargin + bannerHeight + "px";

    // Restore margin when dismissed
    const observer = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node === banner) {
            document.body.style.marginTop = originalMargin + "px";
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
  }

  // ── Real-time SPA link scraper ─────────────────────────────────────────────

  /**
   * WeakSet of <a> elements already processed by the observer.  A WeakSet
   * is used (instead of a Set) so that elements garbage-collected after
   * leaving the DOM don't leak memory.
   */
  const processedAnchors = new WeakSet();

  /**
   * Deduplication set of URL strings that have already been sent to the
   * backend for analysis.  Prevents spamming the API with the same href
   * when it appears in multiple feed posts.
   */
  const scannedUrls = new Set();

  /**
   * Decide whether a link's href is worth sending to the backend.
   *
   * Rejects:
   *   - empty / missing href
   *   - non-HTTP(S) schemes (javascript:, data:, mailto:, tel:, #anchors)
   *   - navigation stubs ("#", "!", "/", "?")
   *   - same-origin links (internal SPA navigation, profile pages, etc.)
   *
   * Accepts everything else — including third-party URLs that might be
   * phishing or scam links embedded in a social-media feed.
   */
  function isValidExternalLink(href) {
    if (!href) return false;

    const trimmed = href.trim();

    // Non-HTTP schemes
    if (/^(javascript|data|mailto|tel|#|blob|file):/i.test(trimmed)) {
      return false;
    }

    // Navigation stubs used by many SPA frameworks
    if (/^[#!\/?]?$/.test(trimmed)) return false;

    // Must be a parseable HTTP(S) URL
    let parsed;
    try {
      parsed = new URL(trimmed, window.location.href);
    } catch (_err) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // Same-origin → internal navigation (e.g. clicking a profile on Twitter)
    if (parsed.hostname === window.location.hostname) return false;

    return true;
  }

  /**
   * Visually mark a dangerous / suspicious <a> element inline in the feed.
   *
   * Applies:
   *   - 3px solid red border
   *   - Light-red translucent background
   *   - An inline warning badge (🚨 [DANGEROUS] or ⚠️ [SUSPICIOUS])
   *     injected as the link's next sibling.
   *
   * Safe to call more than once on the same element — subsequent calls are
   * no-ops thanks to the data-scrollguard-marked attribute guard.
   */
  function markDangerousLink(linkEl, status) {
    if (linkEl.dataset.scrollguardMarked) return;
    linkEl.dataset.scrollguardMarked = "true";

    const isDangerous = status === "Dangerous";

    // -- Visual border + background on the link itself
    linkEl.style.outline = "3px solid " + (isDangerous ? "#dc2626" : "#f59e0b");
    linkEl.style.outlineOffset = "2px";
    linkEl.style.backgroundColor = isDangerous
      ? "rgba(220, 38, 38, 0.10)"
      : "rgba(245, 158, 11, 0.10)";
    linkEl.style.borderRadius = "3px";

    // -- Warning badge injected after the link
    const badge = document.createElement("span");
    badge.className = "__scrollguard_link_badge__";
    badge.textContent = isDangerous
      ? " 🚨 [DANGEROUS]"
      : " ⚠️ [SUSPICIOUS]";

    Object.assign(badge.style, {
      display: "inline-block",
      fontSize: "10px",
      fontWeight: "700",
      fontFamily:
        "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
      color: isDangerous ? "#991b1b" : "#92400e",
      backgroundColor: isDangerous ? "#fee2e2" : "#fef3c7",
      padding: "2px 6px",
      borderRadius: "4px",
      marginLeft: "4px",
      verticalAlign: "middle",
      lineHeight: "1",
      letterSpacing: "0.3px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });

    linkEl.insertAdjacentElement("afterend", badge);
  }

  /**
   * Send a discovered link's URL + visible text to the background service
   * worker for AI analysis.  Wraps the call in a 6-second timeout so that
   * a slow or offline backend never stalls the observer loop.
   */
  async function sendLinkForAnalysis(href, linkText) {
    try {
      const result = await Promise.race([
        analyzeViaBackground(href, linkText),
        new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, 6000);
        }),
      ]);
      return result;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Core observer callback: extract <a> tags from newly added DOM nodes,
   * filter + deduplicate, and dispatch each one for analysis.
   *
   * Each qualifying link is fire-and-forget awaited so that hundreds of
   * feed links can be processed without blocking the main thread.
   */
  function processNewLinks(mutations) {
    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

        // Collect every <a> inside the new subtree (including the node
        // itself if it happens to be an anchor).
        const anchors =
          addedNode.tagName === "A"
            ? [addedNode]
            : Array.from(
                addedNode.querySelectorAll
                  ? addedNode.querySelectorAll("a[href]")
                  : []
              );

        for (const anchor of anchors) {
          // Skip already-processed elements
          if (processedAnchors.has(anchor)) continue;
          processedAnchors.add(anchor);

          const href = anchor.href;
          if (!isValidExternalLink(href)) continue;

          // Deduplication: skip URLs we've already sent to the backend
          if (scannedUrls.has(href)) continue;
          scannedUrls.add(href);

          const linkText =
            (anchor.innerText || anchor.textContent || "").trim().substring(0, 500);

          // Fire-and-forget analysis — mark the link when the result arrives
          sendLinkForAnalysis(href, linkText).then(function (result) {
            if (
              result &&
              !result.error &&
              (result.status === "Dangerous" || result.status === "Suspicious")
            ) {
              // Guard: the link may have been removed from the DOM while we
              // were waiting for the backend response.
              if (anchor.isConnected) {
                markDangerousLink(anchor, result.status);
              }
            }
          });
        }
      }
    }
  }

  // Create and start the MutationObserver.
  // childList: true  → fires when child nodes are added / removed.
  // subtree:   true  → watches the entire document tree, not just <body>'s
  //                    direct children, so deeply nested feed inserts are
  //                    caught too.
  const linkObserver = new MutationObserver(processNewLinks);

  function startLinkObserver() {
    linkObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ── Page-level scan logic ──────────────────────────────────────────────────

  /**
   * Decide whether the combined page-level results warrant showing the
   * top banner.
   */
  function shouldShowBanner(urlHits, textHits, aiResult) {
    // Local heuristics triggered
    if (urlHits.length > 0 || textHits.length > 0) return true;

    // AI backend flagged the page
    if (
      aiResult &&
      !aiResult.error &&
      (aiResult.status === "Dangerous" || aiResult.status === "Suspicious")
    ) {
      return true;
    }

    return false;
  }

  async function scanPage() {
    const pageUrl = window.location.href;
    const pageTitle = document.title || "";
    const pageText = getPageText(5000);

    // Layer 1 – fast local heuristic scan
    const urlHits = checkUrl(pageUrl);
    const textHits = checkText(pageText);

    // Layer 2 – AI analysis via background service worker.
    // Use a 6-second timeout so a slow / offline backend never blocks the page.
    let aiResult = null;
    try {
      aiResult = await Promise.race([
        analyzeViaBackground(pageUrl, pageTitle),
        new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, 6000);
        }),
      ]);
    } catch (_err) {
      // Background service worker unreachable – proceed with local results only
    }

    if (shouldShowBanner(urlHits, textHits, aiResult)) {
      injectBanner(urlHits, textHits, aiResult);
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function init() {
    // Page-level scan (URL + body text against local heuristics + AI)
    scanPage();

    // Start watching for dynamically inserted links (SPA feed scraping)
    startLinkObserver();
  }

  // Run when the DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
