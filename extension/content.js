/**
 * ScrollGuard AI – Content Script
 *
 * Two-layer detection:
 *   1. Fast local heuristic scan (URL patterns + page-text regex).
 *   2. AI-powered analysis via the FastAPI backend, proxied through the
 *      background service worker to avoid CORS / Mixed Content blocks.
 *
 * When either layer flags the page, a fixed warning banner is injected at
 * the top of the DOM.
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
   * Send the page URL and title to background.js for AI-powered analysis.
   * Returns the backend JSON response, or null if the service worker is
   * unreachable (e.g. extension context invalidated, backend offline).
   */
  async function analyzeViaBackground(pageUrl, pageTitle) {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "analyzeUrl",
        url: pageUrl,
        text: pageTitle,
      });
      return result || null;
    } catch (_err) {
      // Service worker may not be ready; silently skip AI analysis
      return null;
    }
  }

  // ── Banner injection ───────────────────────────────────────────────────────

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
   * @param {string[]}   urlHits    Matched URL indicators (may be empty).
   * @param {string[]}   textHits   Matched text indicators (may be empty).
   * @param {Object|null} aiResult  Backend JSON response, or null.
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

  // ── Main scan logic ────────────────────────────────────────────────────────

  /**
   * Decide whether the combined results warrant showing the banner.
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

  async function scan() {
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

  // Run when the DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
})();
