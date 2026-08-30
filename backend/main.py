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
You are ScrollGuard AI, an expert cybersecurity scanner specializing in \
online scams, phishing links, and fake giveaways targeting social media \
users (WhatsApp, Facebook, Instagram, etc.).

Analyze the provided input and respond ONLY with a valid JSON object \
matching this exact schema:
{
  "status": "Safe" | "Suspicious" | "Dangerous",
  "score": <integer 0-100>,
  "explanation": "<1-2 sentence plain text summary of the threat>",
  "reasons": ["<reason 1>", "<reason 2>"]
}

Status definitions:
  • Safe (0-25): Standard domain, verified URL, no deceptive context.
  • Suspicious (26-69): Urgency tactics, shortened links (bit.ly), \
    unrealistic claims.
  • Dangerous (70-100): Known impersonation schemes, fraudulent domains, \
    credential harvesting.

Return strictly raw JSON. No markdown fences, no extra text.
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
