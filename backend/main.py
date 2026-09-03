"""
ScrollGuard AI – FastAPI Detection Engine

Endpoints:
  GET  /            → health check
  POST /analyze     → single URL + text analysis
  POST /scan_links  → batch URL analysis (array of URLs)

Both analysis endpoints run the heuristic pre-filter first.
If the heuristic score is high enough the result is returned
immediately; otherwise the URL is forwarded to the Qwen LLM
for deep analysis.
"""

import asyncio
import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from pydantic import BaseModel
from dotenv import load_dotenv

from heuristics import heuristic_scan

# ── Environment ──────────────────────────────────────────────────────────────

load_dotenv()

API_KEY = os.getenv("DASHSCOPE_API_KEY")
if not API_KEY:
    raise RuntimeError("DASHSCOPE_API_KEY is not set in environment variables.")

client = AsyncOpenAI(
    api_key=API_KEY,
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="ScrollGuard AI Engine", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request / Response models ────────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    url: str = ""
    text: str = ""
    platform: str = "Unknown"

class URLBatch(BaseModel):
    urls: list[str]

# ── System prompt for the LLM ────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are ScrollGuard AI, a high-precision cybersecurity classifier that \
detects phishing links, scam pages, and deceptive giveaways.

JSON FORMAT ENFORCEMENT: Your ENTIRE response MUST be one single, \
valid, parseable JSON object that conforms exactly to the schema \
below. Do NOT wrap the output in markdown code fences. Do NOT add \
any text before or after the JSON. A malformed response is a \
critical failure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTPUT SCHEMA (strict — no extra fields)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "status": "Safe" | "Suspicious" | "Dangerous",
  "score": <integer 0-100>,
  "explanation": "<1-2 sentence plain-text summary>",
  "reasons": ["<reason 1>", "<reason 2>", ...]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 CLASSIFICATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DANGEROUS (score 70-100) — you MUST use this tag when ANY of these apply:
  • Fake government benefit / aid schemes (e.g. BISP, Ehsaas, PM Kisan, \
    "claim your government payment" from unofficial .tk/.ml/.ga domains).
  • Credential harvesting: pages that ask users to "verify", "confirm", \
    or "update" passwords, bank details, or CNIC numbers on non-official \
    domains.
  • Fake lottery / prize scams: "Congratulations, you won!" messages \
    paired with suspicious TLDs or unknown domains.
  • Typosquatting of well-known brands (g00gle.com, paypa1.com, \
    amaz0n-deals.com, faceb00k-login.net).
  • Impersonation of banks or financial institutions on look-alike domains.
  • Deeply nested subdomains designed to mimic a real brand \
    (e.g. secure-login.google.evil-domain.com).

SUSPICIOUS (score 26-69) — use this tag when:
  • Get-rich-quick schemes ("earn $100/day from home", "double your \
    crypto") from non-official domains.
  • URL shorteners (bit.ly, tinyurl, cutt.ly) combined with urgency \
    or unrealistic claims in the surrounding text.
  • High-pressure language ("limited seats", "expires in 24 hours", \
    "act now") from unfamiliar or generic domains.
  • Unrealistic financial promises that do not rise to the level of \
    outright fraud.

SAFE (score 0-15) — use this tag for:
  • Standard websites, official brand domains, and verified subdomains \
    (google.com, github.com, amazon.com, youtube.com, etc.).
  • Regular login portals of well-known services \
    (accounts.google.com, login.microsoftonline.com).
  • Legitimate hackathon, event, or educational registration pages \
    hosted on real organization domains.
  • Shortened links when the surrounding context is clearly benign.
  • URLs that merely contain words like "free" or "login" as part of \
    a legitimate domain's normal structure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 CRITICAL ENFORCEMENT — DANGEROUS STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST use the "Dangerous" status for fake government schemes \
(e.g., BISP/Ehsaas), fake lotteries, and credential harvesting \
phishing links. Do NOT default to "Suspicious" for clear threats. \
When the input matches any Dangerous pattern above, confidently \
return "Dangerous" with a score of 70-100.

Bias rule: only choose Safe over Suspicious when you are genuinely \
uncertain between those two. Uncertainty never justifies downgrading \
a clear threat below "Dangerous".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 FEW-SHOT EXAMPLES (learn from these)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 1 — Dangerous:
  URL: http://bisp-free-money-claim.tk/login
  Text: "Congratulations! You won 50,000 PKR from Benazir Income \
Support. Click to claim now!"
  OUTPUT:
  {
    "status": "Dangerous",
    "score": 95,
    "explanation": "Fake government aid scheme using a .tk domain to \
harvest personal data under the guise of BISP/Ehsaas payments.",
    "reasons": [
      "Fake government benefit claim on suspicious .tk TLD",
      "Unrealistic monetary prize to lure victims",
      "Credential harvesting via /login path on unknown domain"
    ]
  }

EXAMPLE 2 — Suspicious:
  URL: http://bit.ly/3xX9aQz
  Text: "Earn $100 per day by sitting at home. Limited seats left!"
  OUTPUT:
  {
    "status": "Suspicious",
    "score": 55,
    "explanation": "URL shortener paired with unrealistic income claims \
and scarcity-based urgency tactics.",
    "reasons": [
      "Shortened URL (bit.ly) hides the true destination",
      "Unrealistic get-rich-quick income claim",
      "High-pressure urgency language (limited seats)"
    ]
  }

EXAMPLE 3 — Safe:
  URL: https://banoqabil.org/hackathon
  Text: "Alibaba Cloud AI Hackathon Pakistan registration is now open."
  OUTPUT:
  {
    "status": "Safe",
    "score": 5,
    "explanation": "Legitimate event registration page hosted on a \
recognized educational organization's official domain.",
    "reasons": [
      "Official organization domain with HTTPS",
      "No deceptive urgency or phishing indicators"
    ]
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY the raw JSON object. No markdown fences, no preamble.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

# ── Helpers ──────────────────────────────────────────────────────────────────

_MAX_CONCURRENT_AI_CALLS = 5
_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_AI_CALLS)


def _strip_markdown_fences(raw: str) -> str:
    """Remove ```json … ``` wrappers that some LLMs add."""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return raw.strip()


async def _analyze_single_url(url: str, platform: str = "Browser Extension",
                               text: str = "") -> dict:
    """
    Analyze one URL.  Runs the heuristic first; if it flags the URL the
    LLM is never called.  Otherwise delegates to Qwen.

    Returns a dict with keys: url, status, score, explanation, reasons.
    """
    # Heuristic pre-filter
    h_status, h_score, h_reasons = heuristic_scan(url)
    if h_status != "Safe":
        return {
            "url": url,
            "status": h_status,
            "score": h_score,
            "explanation": "Heuristic flags detected before AI analysis.",
            "reasons": h_reasons,
        }

    # LLM analysis (rate-limited via semaphore)
    async with _semaphore:
        user_payload = (
            f"Platform: {platform}\n"
            f"URL: {url}\n"
            f"Text Content: {text or '(auto-extracted)'}"
        )

        try:
            completion = await client.chat.completions.create(
                model="qwen-max",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_payload},
                ],
            )

            raw = _strip_markdown_fences(
                completion.choices[0].message.content.strip()
            )
            parsed = json.loads(raw)

            # Normalize field names coming from the LLM
            return {
                "url": url,
                "status": parsed.get("status", "Safe"),
                "score": parsed.get("score") or parsed.get("risk_score", 0),
                "explanation": parsed.get("explanation", ""),
                "reasons": parsed.get("reasons") or parsed.get("flagged_reasons", []),
            }

        except json.JSONDecodeError:
            return {
                "url": url,
                "status": "Error",
                "score": 0,
                "explanation": "Failed to parse AI response.",
                "reasons": [],
            }
        except Exception as exc:
            return {
                "url": url,
                "status": "Error",
                "score": 0,
                "explanation": str(exc),
                "reasons": [],
            }

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "ScrollGuard AI Detection Engine is active!"}


@app.post("/analyze")
async def analyze_content(request: AnalysisRequest):
    """Analyze a single URL + text payload."""
    if not request.url and not request.text:
        raise HTTPException(
            status_code=400,
            detail="Provide at least a URL or text to analyze.",
        )

    result = await _analyze_single_url(
        url=request.url,
        platform=request.platform,
        text=request.text,
    )

    if result["status"] == "Error":
        raise HTTPException(status_code=500, detail=result["explanation"])

    return result


@app.post("/scan_links")
async def scan_links(batch: URLBatch):
    """Analyze a batch of URLs concurrently (capped by semaphore)."""
    if not batch.urls:
        return []

    tasks = [
        _analyze_single_url(url, platform="Browser Extension")
        for url in batch.urls
    ]
    return await asyncio.gather(*tasks)


# ── Uvicorn entry point (cloud & local) ─────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("ENV", "production") != "production",
    )
