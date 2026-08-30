import re
from urllib.parse import urlparse

def heuristic_scan(url: str):
    """
    Basic rule-based checks for suspicious domains and patterns.
    Returns a tuple: (status, risk_score, reasons)
    """
    reasons = []
    risk_score = 0
    status = "Safe"

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    # Rule 1: Free TLDs often used in scams
    if domain.endswith((".tk", ".ml", ".ga", ".cf", ".gq")):
        reasons.append("Free TLD domain often used in scams")
        risk_score += 40

    # Rule 2: Typosquatting patterns
    if re.search(r"(0|o){2,}|(1|l){2,}|-", domain):
        reasons.append("Possible typosquatting or deceptive domain pattern")
        risk_score += 25

    # Rule 3: Shortened URLs
    if "bit.ly" in domain or "tinyurl" in domain or "t.co" in domain:
        reasons.append("Shortened URL detected")
        risk_score += 20

    # Rule 4: Keywords indicating scams
    scam_keywords = ["claim", "win", "free", "bonus", "reward", "verify", "urgent", "login"]
    if any(keyword in url.lower() for keyword in scam_keywords):
        reasons.append("Suspicious keyword found in URL")
        risk_score += 30

    # Rule 5: HTTPS missing
    if not url.startswith("https://"):
        reasons.append("Missing HTTPS security")
        risk_score += 15

    # Final classification
    if risk_score >= 70:
        status = "Dangerous"
    elif risk_score >= 30:
        status = "Suspicious"

    return status, min(risk_score, 100), reasons
