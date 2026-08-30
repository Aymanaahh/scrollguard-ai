from heuristics import heuristic_scan
import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("DASHSCOPE_API_KEY")
if not api_key:
    raise RuntimeError("DASHSCOPE_API_KEY is not set in environment variables.")

client = OpenAI(
    api_key=api_key,
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

app = FastAPI(title="ScrollGuard AI Engine", version="1.2.0")

# Enable CORS for browser extension communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Request/Response Models -----
class AnalysisRequest(BaseModel):
    url: str = ""
    text: str = ""
    platform: str = "Unknown"

class AnalysisResponse(BaseModel):
    status: str
    risk_score: int
    explanation: str
    flagged_reasons: list[str]

class URLBatch(BaseModel):
    urls: list[str]

SYSTEM_PROMPT = """You are ScrollGuard AI, an expert cybersecurity scanner specializing in online scams, phishing links, and fake giveaways targeting social media users (WhatsApp, Facebook, Instagram, etc.).

Analyze the provided input and respond ONLY with a valid JSON object matching this exact schema:
{
  "status": "Safe" | "Suspicious" | "Dangerous",
  "risk_score": <integer between 0 and 100>,
  "explanation": "<1-2 sentence plain text summary of the threat>",
  "flagged_reasons": ["<reason 1>", "<reason 2>"]
}

Rules:
- Status definitions:
  * Safe: Standard domain, verified URL, no deceptive context (risk_score: 0-25).
  * Suspicious: Urgency tactics, shortened links (bit.ly), unrealistic claims (risk_score: 26-69).
  * Dangerous: Known impersonation schemes (e.g., fake BISP giveaways, fake bank updates), fraudulent domains, credential harvesting (risk_score: 70-100).
- Return strictly raw JSON. Do not include markdown block ticks ```json or any extra conversational text.
"""

# ----- Root Endpoint -----
@app.get("/")
def read_root():
    return {"message": "ScrollGuard AI Detection Engine is active!"}

# ----- Single URL Analysis -----
@app.post("/analyze", response_model=AnalysisResponse)
def analyze_content(request: AnalysisRequest):
    if not request.url and not request.text:
        raise HTTPException(status_code=400, detail="Provide at least a URL or text to analyze.")

    # Run heuristic scan first
    status, score, reasons = heuristic_scan(request.url)
    if status != "Safe":
        return {
            "status": status,
            "risk_score": score,
            "explanation": "Heuristic flags detected before AI analysis.",
            "flagged_reasons": reasons
        }

    user_payload = f"Platform: {request.platform}\nURL: {request.url}\nText Content: {request.text}"

    try:
        completion = client.chat.completions.create(
            model="qwen3.7-plus",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_payload}
            ]
        )
        
        raw_output = completion.choices[0].message.content.strip()
        if raw_output.startswith("```"):
            raw_output = raw_output.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        parsed_response = json.loads(raw_output)
        return parsed_response

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse structured response from AI model.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----- Batch URL Analysis -----
@app.post("/scan_links")
def scan_links(batch: URLBatch):
    results = []
    for url in batch.urls:
        # Run heuristic scan first
        status, score, reasons = heuristic_scan(url)
        if status != "Safe":
            results.append({
                "url": url,
                "status": status,
                "risk_score": score,
                "explanation": "Heuristic flags detected before AI analysis.",
                "flagged_reasons": reasons
            })
            continue

        user_payload = f"Platform: Browser Extension\nURL: {url}\nText Content: (auto-extracted)"
        try:
            completion = client.chat.completions.create(
                model="qwen3.7-plus",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_payload}
                ]
            )
            raw_output = completion.choices[0].message.content.strip()
            if raw_output.startswith("```"):
                raw_output = raw_output.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            parsed_response = json.loads(raw_output)
            results.append({"url": url, **parsed_response})
        except Exception as e:
            results.append({
                "url": url,
                "status": "Error",
                "risk_score": 0,
                "explanation": str(e),
                "flagged_reasons": []
            })
    return results
