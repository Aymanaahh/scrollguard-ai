"""
ScrollGuard AI – Heuristic Engine

Fast, rule-based pre-filter that runs before the LLM analysis.
If a URL scores high enough the backend returns the result
immediately without consuming AI tokens.

Returns: (status: str, risk_score: int, reasons: list[str])
"""

import re
from urllib.parse import urlparse

# ── Rule definitions ─────────────────────────────────────────────────────────

# Free / abused TLDs
_SUSPICIOUS_TLDS = (".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top",
                    ".buzz", ".click", ".icu", ".cam")

# URL-shortener services
_SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "ow.ly", "shorturl.at",
               "goo.gl", "is.gd", "buff.ly", "rebrand.ly"}

# Keywords checked against the URL *path* only (not the domain)
_PATH_KEYWORDS = (
    "claim", "winner", "free-money", "free-crypto", "giveaway",
    "bonus", "reward", "verify-account", "urgent-security",
    "login-secure", "confirm-identity", "suspended-account",
    "double-bitcoin", "free-gift",
)

# Keywords checked against the domain name
_DOMAIN_KEYWORDS = (
    "free-money", "free-crypto", "claim-now", "verify-urgent",
    "account-verify", "bank-account-verify", "secure-login",
    "login-secure", "confirm-identity",
)


def heuristic_scan(url: str) -> tuple[str, int, list[str]]:
    """
    Run rule-based checks on *url*.
    Returns (status, risk_score, reasons).
    """
    reasons: list[str] = []
    risk_score = 0

    try:
        parsed = urlparse(url)
    except Exception:
        return "Safe", 0, []

    domain = (parsed.netloc or "").lower()
    path = (parsed.path or "").lower() + (parsed.query or "").lower()

    # ── Rule 1: Suspicious / free TLDs ───────────────────────────────────
    if domain.endswith(_SUSPICIOUS_TLDS):
        reasons.append("Free / suspicious TLD often abused for scams")
        risk_score += 40

    # ── Rule 2: URL shortener services ───────────────────────────────────
    base_domain = ".".join(domain.split(".")[-2:])  # e.g. "bit.ly"
    if base_domain in _SHORTENERS:
        reasons.append("URL shortener service detected")
        risk_score += 20

    # ── Rule 3: Excessive subdomain depth (phishing indicator) ───────────
    parts = domain.split(".")
    if len(parts) > 4:
        reasons.append("Unusually deep subdomain nesting")
        risk_score += 15

    # ── Rule 4: Hyphen-heavy domain (common in phishing) ────────────────
    if domain.count("-") >= 3:
        reasons.append("Domain with many hyphens (phishing pattern)")
        risk_score += 20

    # ── Rule 5: Typosquatting patterns ───────────────────────────────────
    # Only flag when a known brand-like substitution appears, not for
    # legitimate domains like "google.com".
    if re.search(r"g00gl|paypa1|amaz0n|faceb00k|app1e|mircosoft", domain):
        reasons.append("Possible typosquatting of a known brand")
        risk_score += 35

    # ── Rule 6: Scam keywords in path / query string ─────────────────────
    if any(kw in path for kw in _PATH_KEYWORDS):
        reasons.append("Suspicious keyword found in URL path")
        risk_score += 30

    # ── Rule 7: Scam keywords in domain name ─────────────────────────────
    if any(kw in domain for kw in _DOMAIN_KEYWORDS):
        reasons.append("Suspicious keyword found in domain name")
        risk_score += 25

    # ── Rule 8: Missing HTTPS ────────────────────────────────────────────
    if not url.lower().startswith("https://"):
        reasons.append("Missing HTTPS (insecure connection)")
        risk_score += 10

    # ── Final classification ─────────────────────────────────────────────
    risk_score = min(risk_score, 100)
    if risk_score >= 70:
        status = "Dangerous"
    elif risk_score >= 30:
        status = "Suspicious"
    else:
        status = "Safe"

    return status, risk_score, reasons
