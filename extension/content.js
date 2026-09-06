/**
 * ScrollGuard AI – Content Script
 *
 * Zero-click, real-time link scanner for SPAs and static pages.
 *
 * Architecture:
 *   1. Main-page scan  – On load, sends window.location.href to the backend.
 *      If the page itself is flagged, a fixed top warning banner is injected.
 *   2. Inline link scan – querySelectorAll + MutationObserver scans every
 *      external <a> tag.  Flagged links get coloured outlines and interactive
 *      badges that open a detail modal on click.
 *   3. Allowlist – Trusted domains are skipped automatically to conserve
 *      API quota and eliminate false positives on known-safe sites.
 *   4. Auth-path filter – Scraped links containing standard authentication
 *      paths (login, signin, signup, auth, oauth, register) are skipped
 *      without an API call — auth pages are overwhelmingly legitimate and
 *      were a leading source of false positives.
 *
 * All injected CSS classes are prefixed with "sg-ai-" to prevent host-page
 * stylesheet collisions.  UI components share one dark "raven" theme
 * (see THEME below) and animate via a single idempotent stylesheet.
 */

(function () {
  "use strict";

  // ── Deduplication ──────────────────────────────────────────────────────────

  /** Set of href strings already sent to the backend. */
  const scannedUrls = new Set();

  /** WeakSet of <a> elements already processed (GC-safe). */
  const processedAnchors = new WeakSet();

  // ── Trusted domain allowlist ───────────────────────────────────────────────

  /**
   * Domains that are always treated as safe.  Checking is suffix-based so
   * subdomains (www.google.com, mail.google.com) are also covered.
   *
   * This list saves API quota and prevents false positives on sites that
   * are universally trusted.
   */
  const TRUSTED_DOMAINS = [
    "google.com",
    "youtube.com",
    "github.com",
    "facebook.com",
    "linkedin.com",
    "microsoft.com",
    "apple.com",
    "amazon.com",
    "twitter.com",
    "x.com",
    "wikipedia.org",
    "reddit.com",
    "stackoverflow.com",
    "instagram.com",
    "whatsapp.com",
    "netflix.com",
    "yahoo.com",
    "bing.com",
    "twitch.tv",
    "medium.com",
  ];

  /**
   * Check whether a hostname belongs to a trusted domain.
   * Matches exact hostnames and subdomains (e.g. www.google.com,
   * mail.google.com) but NOT look-alikes (e.g. evilgoogle.com).
   *
   * @param {string} hostname
   * @returns {boolean} true if the hostname is trusted.
   */
  function isAllowlisted(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(
      (d) => lower === d || lower.endsWith("." + d)
    );
  }

  // ── Authentication-path filter ─────────────────────────────────────────────

  /**
   * Standard authentication path keywords.  Any scraped link whose URL
   * string contains one of these is skipped entirely — no API call is
   * made and the link is ignored.
   *
   * Rationale: login portals, sign-up flows, and OAuth redirects are
   * overwhelmingly legitimate pages and were a leading source of false
   * positives.  Skipping them also conserves API quota.
   */
  const AUTH_PATH_KEYWORDS = [
    "login",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "auth",
    "oauth",
    "register",
  ];

  /**
   * Check whether a URL string contains a standard authentication path.
   *
   * @param {string} url - The absolute href string to inspect.
   * @returns {boolean} true if an auth keyword is present.
   */
  function hasAuthPath(url) {
    const lower = url.toLowerCase();
    return AUTH_PATH_KEYWORDS.some((k) => lower.includes(k));
  }

  // ── Theme & injected styles ────────────────────────────────────────────────

  /**
   * Single source of truth for every colour used by the injected UI
   * (banner, modal, badges, outlines).  Keeping the palette in one place
   * guarantees a consistent "Team Raven" dark look and removes the
   * duplicated status-based ternaries that used to live in each builder.
   */
  const THEME = {
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    Dangerous: {
      gradient: "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)",
      accent: "#f87171",
      outline: "3px solid #dc2626",
      tint: "rgba(220, 38, 38, 0.10)",
      badgeBg: "#dc2626",
      badgeColor: "#ffffff",
      badgeShadow: "0 2px 10px rgba(220, 38, 38, 0.45)",
      glow: "rgba(220, 38, 38, 0.30)",
      icon: "\uD83D\uDEA8",
      badgeText: " \uD83D\uDEA8 [DANGEROUS SCAN]",
    },
    Suspicious: {
      gradient: "linear-gradient(135deg, #92400e 0%, #d97706 100%)",
      accent: "#fbbf24",
      outline: "3px solid #d97706",
      tint: "rgba(217, 119, 6, 0.10)",
      badgeBg: "#fbbf24",
      badgeColor: "#1e293b",
      badgeShadow: "0 2px 10px rgba(217, 119, 6, 0.40)",
      glow: "rgba(217, 119, 6, 0.28)",
      icon: "\u26A0\uFE0F",
      badgeText: " \u26A0\uFE0F [SUSPICIOUS SCAN]",
    },
  };

  /**
   * Resolve the theme palette for a threat status.
   *
   * @param {string} status - "Dangerous" or "Suspicious".
   * @returns {Object} Theme entry with colours, icons, and badge text.
   */
  function threatTheme(status) {
    return status === "Dangerous" ? THEME.Dangerous : THEME.Suspicious;
  }

  /**
   * Inject the ScrollGuard stylesheet once per page (idempotent).
   *
   * Holds the keyframe animations (modal fade/scale-in, badge pop-in,
   * banner slide-down) and the hover transitions for badges/buttons.
   * Every rule only touches properties that are NOT set inline, so
   * host-page stylesheets can never break the injected UI and the
   * inline base styles never block the animations.
   */
  function ensureStylesheet() {
    if (document.getElementById("sg-ai-styles")) return;

    const style = document.createElement("style");
    style.id = "sg-ai-styles";
    style.textContent = [
      "@keyframes sgAiFadeIn { from { opacity: 0; } to { opacity: 1; } }",
      "@keyframes sgAiModalIn {",
      "  from { opacity: 0; transform: translateY(14px) scale(0.96); }",
      "  to { opacity: 1; transform: translateY(0) scale(1); }",
      "}",
      "@keyframes sgAiBadgePop {",
      "  from { opacity: 0; transform: scale(0.6); }",
      "  70% { transform: scale(1.08); }",
      "  to { opacity: 1; transform: scale(1); }",
      "}",
      "@keyframes sgAiBannerDown {",
      "  from { transform: translateY(-100%); }",
      "  to { transform: translateY(0); }",
      "}",
      ".sg-ai-page-banner { animation: sgAiBannerDown 0.25s ease-out; }",
      ".sg-ai-modal-overlay { animation: sgAiFadeIn 0.2s ease-out; }",
      ".sg-ai-modal { animation: sgAiModalIn 0.22s ease-out; }",
      ".sg-ai-badge {",
      "  animation: sgAiBadgePop 0.25s ease-out;",
      "  transition: transform 0.2s ease-in-out, filter 0.2s ease-in-out;",
      "}",
      ".sg-ai-badge:hover {",
      "  transform: translateY(-1px) scale(1.06);",
      "  filter: brightness(1.12);",
      "}",
      ".sg-ai-btn { transition: all 0.2s ease-in-out; }",
      ".sg-ai-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }",
      ".sg-ai-btn:active { transform: translateY(0) scale(0.97); }",
      ".sg-ai-banner-dismiss { transition: background 0.2s ease-in-out; }",
      ".sg-ai-banner-dismiss:hover {",
      "  background: rgba(255, 255, 255, 0.35) !important;",
      "}",
    ].join("\n");

    (document.head || document.documentElement).appendChild(style);
  }

  // ── URL tracking-parameter sanitizer ──────────────────────────────────────

  /**
   * Query-string parameter names added by ad networks, social platforms, and
   * analytics SDKs.  Stripping them before sending URLs to the backend
   * shrinks payloads (some fbclid/gclid values exceed 200 chars), prevents
   * the LLM from wasting context on marketing metadata, and lets the
   * scannedUrls Set key on the meaningful portion of the URL.
   *
   * Origin, path, hash, and non-tracking query parameters are preserved so
   * threat detection accuracy is unaffected.
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

  // ── Link extraction & validation ───────────────────────────────────────────

  /**
   * Decide whether an href is worth sending to the backend.
   *
   * Rejects empty, javascript:, data:, mailto:, tel:, #anchor,
   * navigation stubs, authentication paths (login, signin, signup,
   * auth, oauth, register), same-origin links, and allowlisted domains.
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

    // Standard authentication path (login, signin, signup, auth, oauth,
    // register) → skip the API call entirely to save quota and eliminate
    // false positives on legitimate auth pages
    if (hasAuthPath(trimmed)) return false;

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

    // Trusted domain → skip
    if (isAllowlisted(parsed.hostname)) return false;

    return true;
  }

  /**
   * Collect all <a> elements in the given root(s) whose href passes
   * validation and that haven't been processed yet.  Returns a
   * deduplicated array of { element, href } objects (one per unique URL —
   * subsequent duplicates are skipped from the batch but still marked via
   * processedAnchors).
   *
   * Accepts a single root or an array of roots so a whole mutation burst
   * can be coalesced into ONE scan batch.
   *
   * @param {Element|Element[]} roots
   */
  function collectNewLinks(roots) {
    const rootList = Array.isArray(roots) ? roots : [roots];
    const batch = [];

    for (const root of rootList) {
      if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;

      // Cheap pre-filter: skip subtrees that cannot contain anchors.
      // On heavy social feeds most inserted nodes are text/media/decor,
      // so this keeps the observer path close to O(1) per mutation.
      const isAnchor = root.tagName === "A";
      if (!isAnchor && !(root.querySelector && root.querySelector("a[href]"))) {
        continue;
      }

      const anchors = isAnchor
        ? [root]
        : Array.from(root.querySelectorAll("a[href]"));

      for (const anchor of anchors) {
        if (processedAnchors.has(anchor)) continue;
        processedAnchors.add(anchor);

        const href = anchor.href;
        if (!isValidExternalLink(href)) continue;

        // Sanitise before the dedup Set so two URLs differing only in
        // tracking query parameters (fbclid, utm_source, …) collapse to
        // one entry — saving backend quota on duplicate marketing hits.
        const clean = stripTrackingParams(href);

        // URL-level dedup: only add to batch if not yet scanned
        if (!scannedUrls.has(clean)) {
          scannedUrls.add(clean);
          batch.push({ element: anchor, href: clean });
        }
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

  // ── Main-page banner ───────────────────────────────────────────────────────

  /**
   * Scan the current page URL (window.location.href) via the backend.
   * If flagged as Dangerous or Suspicious, inject a fixed top warning banner.
   * Trusted domains are skipped automatically.
   */
  async function scanMainPage() {
    const pageUrl = window.location.href;

    if (isAllowlisted(window.location.hostname)) return;

    // Strip tracking parameters before sending to the backend so the LLM
    // sees the meaningful portion of the URL only.
    const cleanUrl = stripTrackingParams(pageUrl);
    // Eagerly record the attempt so the popup flips to "Active" before
    // the backend call returns (or times out).
    recordAttempts(1);
    const results = await sendToBackground([cleanUrl]);
    if (!Array.isArray(results) || results.length === 0) return;

    const result = results[0];
    if (!result || result.error) return;

    if (result.status === "Dangerous" || result.status === "Suspicious") {
      injectPageBanner(result);
    }
  }

  /**
   * Inject a fixed top warning banner when the main page itself is flagged.
   *
   *   Dangerous  → red banner with shield icon
   *   Suspicious → amber banner with warning icon
   *
   * Includes a dismiss (X) button and slides in via the injected
   * stylesheet animation.  All styles are inline and classes prefixed
   * with "sg-ai-" for isolation from the host stylesheet.
   *
   * @param {Object} result - Backend result for the page URL.
   */
  function injectPageBanner(result) {
    // Prevent duplicate banners
    if (document.querySelector("[data-sg-ai-banner]")) return;

    const theme = threatTheme(result.status);
    const score = result.score || 0;

    // ── Banner container ──
    const banner = document.createElement("div");
    banner.setAttribute("data-sg-ai-banner", "true");
    banner.className = "sg-ai-page-banner";
    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      zIndex: "2147483646",
      background: theme.gradient,
      color: "#ffffff",
      padding: "12px 50px 12px 16px",
      fontFamily: THEME.fontFamily,
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    // Icon
    const icon = document.createElement("span");
    icon.textContent = theme.icon;
    Object.assign(icon.style, { fontSize: "22px", lineHeight: "1" });
    banner.appendChild(icon);

    // Text content
    const textWrap = document.createElement("div");
    textWrap.style.flex = "1";

    const headline = document.createElement("strong");
    headline.textContent =
      "ScrollGuard AI: This page is " + result.status.toUpperCase();
    Object.assign(headline.style, {
      fontSize: "14px",
      fontWeight: "700",
      letterSpacing: "0.3px",
    });

    const detail = document.createElement("div");
    detail.textContent =
      "Risk Score: " + score + "/100 — " +
      (result.explanation || "Potential threat detected on this page.");
    Object.assign(detail.style, {
      fontSize: "12px",
      opacity: "0.9",
      marginTop: "2px",
    });

    textWrap.appendChild(headline);
    textWrap.appendChild(detail);
    banner.appendChild(textWrap);

    // Dismiss button
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "sg-ai-banner-dismiss";
    dismissBtn.textContent = "\u2715";
    dismissBtn.title = "Dismiss warning";
    dismissBtn.setAttribute("aria-label", "Dismiss warning banner");
    Object.assign(dismissBtn.style, {
      position: "absolute",
      top: "8px",
      right: "12px",
      background: "rgba(255,255,255,0.2)",
      border: "none",
      color: "#ffffff",
      fontSize: "16px",
      fontWeight: "700",
      cursor: "pointer",
      padding: "4px 8px",
      borderRadius: "4px",
      lineHeight: "1",
    });
    dismissBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      banner.remove();
    });
    banner.appendChild(dismissBtn);

    // Insert at the very top of <body>
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // ── Interactive explanation modal ──────────────────────────────────────────

  /**
   * Inject a full-screen overlay modal showing the AI analysis details
   * for a flagged link.  The modal includes:
   *   - Threat level header with warning icon and ScrollGuard logo
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

    const theme = threatTheme(data.status);

    // ── Overlay backdrop ──
    const overlay = document.createElement("div");
    overlay.className = "sg-ai-modal-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      background: "rgba(15, 23, 42, 0.72)",
      backdropFilter: "blur(4px)",
      webkitBackdropFilter: "blur(4px)",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: THEME.fontFamily,
    });

    // ── Modal container (dark "raven" surface) ──
    const modal = document.createElement("div");
    modal.className = "sg-ai-modal";
    Object.assign(modal.style, {
      background: "#18181b",
      borderRadius: "14px",
      width: "420px",
      maxWidth: "90vw",
      maxHeight: "80vh",
      overflow: "auto",
      boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6), 0 0 32px " + theme.glow,
      border: "1px solid rgba(148, 163, 184, 0.18)",
    });

    // ── Header ──
    const header = document.createElement("div");
    header.className = "sg-ai-modal-header";
    Object.assign(header.style, {
      background: theme.gradient,
      color: "#ffffff",
      padding: "16px 20px",
      borderRadius: "13px 13px 0 0",
      display: "flex",
      alignItems: "center",
      gap: "10px",
    });

    const icon = document.createElement("span");
    icon.className = "sg-ai-modal-icon";
    icon.textContent = theme.icon;
    Object.assign(icon.style, { fontSize: "24px", lineHeight: "1" });
    header.appendChild(icon);

    const titleWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "sg-ai-modal-title";
    title.textContent = data.status.toUpperCase();
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

    // Brand logo (right-aligned alongside the warning title).  Loaded via
    // chrome.runtime.getURL so the chrome-extension:// URL resolves in the
    // host page; requires the icons to be web-accessible in the manifest.
    const logo = document.createElement("img");
    logo.className = "sg-ai-modal-logo";
    logo.src = chrome.runtime.getURL("icons/icon48.png");
    logo.alt = "ScrollGuard AI";
    Object.assign(logo.style, {
      width: "32px",
      height: "32px",
      marginLeft: "auto",
      borderRadius: "6px",
      flexShrink: "0",
    });
    header.appendChild(logo);

    modal.appendChild(header);

    // ── Body ──
    const body = document.createElement("div");
    body.className = "sg-ai-modal-body";
    Object.assign(body.style, { padding: "20px" });

    // URL field
    body.appendChild(buildModalField("Scanned URL", data.url, {
      wordBreak: "break-all",
      color: "#7dd3fc",
      fontSize: "12px",
    }));

    // Risk score
    body.appendChild(buildModalField("Risk Score", data.score + " / 100", {
      fontWeight: "700",
      fontSize: "18px",
      color: theme.accent,
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
        color: "#94a3b8",
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
        color: "#cbd5e1",
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

    // "Close / Stay Safe" button (primary action)
    const staySafeBtn = document.createElement("button");
    staySafeBtn.className = "sg-ai-btn sg-ai-btn-stay-safe";
    staySafeBtn.textContent = "Close / Stay Safe";
    Object.assign(staySafeBtn.style, {
      flex: "1",
      padding: "11px 16px",
      background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
      color: "#ffffff",
      border: "none",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "inherit",
      boxShadow: "0 2px 10px rgba(37, 99, 235, 0.35)",
    });
    staySafeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    });

    // "Proceed Anyway" button (secondary, dark surface)
    const proceedBtn = document.createElement("button");
    proceedBtn.className = "sg-ai-btn sg-ai-btn-proceed";
    proceedBtn.textContent = "Proceed Anyway";
    Object.assign(proceedBtn.style, {
      flex: "1",
      padding: "11px 16px",
      background: "#1e293b",
      color: "#94a3b8",
      border: "1px solid #334155",
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
   * Build a labelled field row for the modal body (dark theme colours).
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
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom: "4px",
    });
    lbl.textContent = label;

    const val = document.createElement("div");
    val.className = "sg-ai-modal-field-value";
    Object.assign(val.style, {
      fontSize: "13px",
      color: "#e2e8f0",
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
    const theme = threatTheme(status);

    // ── Link border + background tint ──
    linkEl.style.outline = theme.outline;
    linkEl.style.outlineOffset = "2px";
    linkEl.style.borderRadius = "4px";
    linkEl.style.backgroundColor = theme.tint;
    linkEl.style.transition =
      "outline-color 0.2s ease-in-out, background-color 0.2s ease-in-out";

    // ── Inline badge ──
    const badge = document.createElement("span");
    badge.className = "sg-ai-badge";
    badge.textContent = theme.badgeText;
    badge.title = "ScrollGuard: Click for details (Risk " + score + "/100)";

    Object.assign(badge.style, {
      display: "inline-block",
      fontSize: "11px",
      fontWeight: "700",
      fontFamily: THEME.fontFamily,
      marginLeft: "4px",
      marginRight: "2px",
      padding: "2px 8px",
      borderRadius: "6px",
      verticalAlign: "middle",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      cursor: "pointer",
      userSelect: "none",
      background: theme.badgeBg,
      color: theme.badgeColor,
      boxShadow: theme.badgeShadow,
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
   * Running count of URLs dispatched to the backend (before any response
   * arrives).  Incremented eagerly by recordAttempts() so the popup can
   * show "Active" the moment a batch leaves the content script — even if
   * the backend never replies (timeout / network error).
   */
  let totalAttempted = 0;

  /**
   * Persist scan statistics to chrome.storage.local so the popup can
   * display them, and broadcast a live update to any open popup.
   */
  function persistStats() {
    chrome.storage.local.set({
      sg_linksScanned: totalScanned,
      sg_linksFlagged: totalFlagged,
      sg_linksAttempted: totalAttempted,
    });
    // Best-effort broadcast to open popup
    try {
      chrome.runtime.sendMessage({
        action: "updateStats",
        scanned: totalScanned,
        flagged: totalFlagged,
        attempted: totalAttempted,
      });
    } catch (_e) { /* popup may not be open */ }
  }

  /**
   * Eagerly bump the attempt counter by `count` and broadcast the new
   * value to storage and any open popup.  Called BEFORE the backend call
   * so the status chip flips to "Active" immediately instead of waiting
   * up to 30 s for a timeout fallback.
   *
   * @param {number} count - Number of URLs about to be sent.
   */
  function recordAttempts(count) {
    totalAttempted += count;
    chrome.storage.local.set({ sg_linksAttempted: totalAttempted });
    try {
      chrome.runtime.sendMessage({
        action: "updateStats",
        scanned: totalScanned,
        flagged: totalFlagged,
        attempted: totalAttempted,
      });
    } catch (_e) { /* popup may not be open */ }
  }

  /**
   * Collect new links from the given root(s), send them to the backend in
   * a single batch, and apply inline markings for any flagged results.
   *
   * @param {Element|Element[]} roots - One root element or many.
   */
  async function scanLinks(roots) {
    const newLinks = collectNewLinks(roots || document.body);
    if (newLinks.length === 0) return;

    // Eagerly record the attempt count so the popup shows "Active"
    // immediately, even if the backend times out or is unreachable.
    recordAttempts(newLinks.length);

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
   *
   * Efficiency guards:
   *   - Mutations produced by ScrollGuard's own UI (badges, banner,
   *     modal — all carry the "sg-ai-" class prefix or the
   *     data-sg-ai-banner attribute) are ignored, so marking a link
   *     never re-triggers the scanner.
   *   - All pending roots are flushed through ONE scanLinks() call,
   *     producing a single backend round-trip per mutation burst
   *     instead of one request per inserted node.
   */
  let mutationTimer = null;
  const pendingRoots = new Set();

  function onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Skip nodes injected by ScrollGuard itself (cheap attribute
        // checks only — no DOM traversal).
        const cls = node.getAttribute("class");
        if (
          (typeof cls === "string" && cls.indexOf("sg-ai-") !== -1) ||
          node.hasAttribute("data-sg-ai-banner")
        ) {
          continue;
        }

        pendingRoots.add(node);
      }
    }

    if (!mutationTimer) {
      mutationTimer = setTimeout(() => {
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        mutationTimer = null;

        if (roots.length > 0) {
          // One coalesced scan for every pending root.
          scanLinks(roots);
        }
      }, 300);
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function init() {
    // Brand styles + animations (idempotent, injected once per page)
    ensureStylesheet();

    // Single startup status log — the only non-error console output.
    console.log(
      "[ScrollGuard AI] Zero-click scanner active on " + window.location.hostname
    );

    // 1. Scan the main page URL itself (skip if allowlisted)
    scanMainPage();

    // 2. Initial scan: every <a> already present in the DOM
    scanLinks(document.body);

    // 3. Dynamic scan: watch for newly inserted <a> tags
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
