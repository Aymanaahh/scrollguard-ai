# ScrollGuard AI

**Zero-Click, Real-Time AI Protection Against Phishing & Scam Links**

> Built for the Alibaba Cloud AI Hackathon by **Team Raven**

---

## Overview

ScrollGuard AI is a browser security extension paired with an AI-powered detection backend. It automatically scans every page you visit — including dynamically loaded content in social media feeds — and flags phishing links, fake government schemes (BISP/Ehsaas scams), fraudulent lotteries, and credential-harvesting pages directly in the page, in real time, with zero clicks required.

The system pairs a Chrome Manifest V3 extension with a Python FastAPI backend that classifies URLs through a two-stage pipeline: rule-based heuristics followed by Alibaba Cloud's Qwen LLM using aggressive few-shot prompting.

---

## Core Features

### Zero-Click Auto-Scanner

- Scanning starts automatically the moment a page loads — there is no button to press and no configuration required.
- The current page URL itself is checked first. If the page you are on is a threat, a full-width warning banner (red for Dangerous, amber for Suspicious) is pinned to the top of the screen with the risk score and AI explanation.
- A manual "Scan Active Tab" fallback remains available in the popup for on-demand verification.

### Real-Time SPA Link Scraping via MutationObserver

- A `MutationObserver` attached to `document.body` catches every `<a>` tag injected after initial load — infinite-scroll feeds on Facebook, X, WhatsApp Web, Instagram, and Reddit are fully covered.
- Mutations are debounced at 300 ms and deduplicated (`Set` for URLs, `WeakSet` for elements), so each unique link triggers exactly one API call per session.
- Three client-side filters run **before** any request is made, saving API quota and eliminating false positives:
  - **Trusted-domain allowlist** — 20 major domains (google.com, github.com, etc.) and their subdomains are skipped instantly.
  - **Auth-path filter** — scraped links containing standard authentication paths (`login`, `signin`, `signup`, `auth`, `oauth`, `register`) are skipped automatically.
  - **Scheme and same-origin filters** — `javascript:`, `mailto:`, `data:`, and internal navigation links never reach the backend.

### Interactive Inline DOM Threat Badges

- Flagged links are outlined in place: red for Dangerous, amber for Suspicious.
- A clickable badge (`[DANGEROUS SCAN]` / `[SUSPICIOUS SCAN]`) is injected next to each flagged link.
- Clicking a badge opens a full-screen explanation modal showing the scanned URL, risk score (X/100), the Qwen LLM's explanation, and the specific reasons the link was flagged — plus "Close / Stay Safe" and "Proceed Anyway" actions.
- All injected UI uses `sg-ai-` prefixed classes and inline styles, so host-page CSS can never hide or break it.

### High-Accuracy Detection Engine

- Two-stage pipeline: an 8-rule heuristic pre-filter (suspicious TLDs, shorteners, typosquatting, keyword analysis) followed by Qwen LLM deep analysis.
- The system prompt uses **aggressive few-shot prompting** with worked examples for each threat level and a critical-enforcement directive that mandates the "Dangerous" classification for fake government schemes, fake lotteries, and credential harvesting — preventing the model from downgrading clear threats to "Suspicious".

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.10+, FastAPI, Uvicorn, Pydantic, python-dotenv |
| AI Engine | Alibaba Cloud DashScope API — Qwen LLM (`qwen-max`) with few-shot prompting |
| Extension | Chrome Manifest V3 (service worker + content scripts), JavaScript, HTML5, CSS3 |
| Deployment | Procfile-based PaaS deployment (Render / Heroku / Alibaba Cloud), Docker-ready |

### Chrome Extension — Manifest V3 Service Worker Architecture

- **`content.js`** runs on every page: performs the zero-click scans, applies the client-side false-positive filters, and injects the banners, badges, and modals.
- **`background.js`** is the sole network fetcher. All backend calls are routed through the extension's privileged service-worker context, which bypasses the CORS and Mixed-Content restrictions that would otherwise block a content script from reaching an HTTP backend on an HTTPS page.
- **`popup.html` / `popup.js`** provide the status dashboard: an always-on "Auto-scanning links in background" banner, live scan statistics synced via `chrome.storage`, and the manual scan fallback.

### Backend — Python FastAPI

- Fully async: `AsyncOpenAI` client, `asyncio.gather()` for concurrent batch analysis, and a `Semaphore(5)` rate limiter for LLM calls.
- Endpoints: `GET /` (health check), `POST /analyze` (single URL + text), `POST /scan_links` (batch URL analysis).
- Cloud-ready: binds to `0.0.0.0` with the port dynamically set by the `PORT` environment variable.

### AI Engine — Qwen LLM Integration

- Alibaba Cloud DashScope (OpenAI-compatible API) powering the Qwen LLM.
- The system prompt embeds strict classification rules, three worked few-shot examples (Dangerous / Suspicious / Safe), a critical-enforcement directive for the "Dangerous" status, and hard JSON-format constraints.

---

## Screenshots & Data Flow

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                     Browser Tab                         │
│                                                         │
│  ┌───────────┐    querySelectorAll / MutationObserver   │
│  │ content.js │ ──────────────────────────────────────► │
│  └─────┬─────┘   (allowlist + auth-path + dedup filters)│
│        │ chrome.runtime.sendMessage                     │
│        ▼                                                │
│  ┌──────────────┐                                       │
│  │ background.js │  (Service Worker – CORS bypass)      │
│  └──────┬───────┘                                       │
└─────────┼───────────────────────────────────────────────┘
          │ fetch()
          ▼
┌─────────────────────────────────────┐
│       FastAPI Backend (Uvicorn)      │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │ Heuristic │───►│ Qwen LLM     │  │
│  │ Pre-filter│    │ (few-shot)   │  │
│  └──────────┘    └───────────────┘  │
│                                     │
│  Returns: { status, score,          │
│            explanation, reasons }   │
└─────────────────────────────────────┘
```

### Popup UI
![Popup Dashboard](docs/screenshots/popup-dashboard.png)
*The popup dashboard showing the auto-scan status banner, live statistics, and the manual scan fallback.*

### Inline Threat Badges
![Inline Warnings](docs/screenshots/inline-warnings.png)
*Dangerous (red) and Suspicious (amber) inline badges with their detail modal on a social media feed.*

### Data Flow Diagram
![Architecture](docs/screenshots/data-flow-diagram.png)
*End-to-end data flow from browser tab through service worker to FastAPI backend.*

---

## Installation & Setup

### Prerequisites

- Python 3.10+
- Google Chrome or Microsoft Edge
- An active [Alibaba Cloud DashScope API Key](https://dashscope.console.alibabacloud.com/)

### 1. Backend Setup

```bash
# Clone the repository
git clone https://github.com/Aymanaahh/scrollguard-ai.git
cd scrollguard-ai/backend

# Install dependencies
pip install fastapi uvicorn openai python-dotenv pydantic requests

# Configure environment
cp .env.example .env
# Edit .env and add your DASHSCOPE_API_KEY (no quotes)
```

**Start locally:**

```bash
python main.py
# Or with auto-reload for development:
python -m uvicorn main:app --reload --port 8000
```

The API docs are available at: `http://127.0.0.1:8000/docs`

### 2. Extension Setup

1. Open your browser and navigate to:
   - **Chrome:** `chrome://extensions/`
   - **Edge:** `edge://extensions/`
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked**.
4. Select the `scrollguard-ai/extension` folder.
5. Pin **ScrollGuard AI** to your toolbar. Protection is now automatic — visit any page and links are scanned in the background.

### 3. Pointing the Extension at a Cloud Backend

By default, the extension targets `http://127.0.0.1:8000/scan_links` (local development). To use a cloud-deployed backend:

1. Navigate to `chrome://extensions/`
2. Click the **service worker** link under ScrollGuard AI to open the DevTools console.
3. Run:
   ```js
   chrome.storage.local.set({
     sg_backendUrl: "https://your-app.onrender.com/scan_links"
   })
   ```
4. Reload the extension. All requests now route to your cloud backend.

---

## Cloud Deployment (Backend)

### Render / Heroku / Railway

The backend includes a `Procfile` for standard PaaS deployment:

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

**Render.com deployment:**

1. Push the `backend/` directory to a GitHub repository.
2. Create a new **Web Service** on Render and connect the repo.
3. Set the environment variable: `DASHSCOPE_API_KEY=<your_key>`
4. Deploy. Render automatically assigns the `PORT` variable.

**Alibaba Cloud (ECS / Function Compute):**

1. Upload the backend to your instance.
2. Set environment variables: `DASHSCOPE_API_KEY`, `PORT` (default 8000).
3. Run: `python main.py`

### Docker (Optional)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/ .
RUN pip install --no-cache-dir fastapi uvicorn openai python-dotenv pydantic requests
EXPOSE 8000
CMD ["python", "main.py"]
```

---

## Packaging the Extension for Store Submission

### Chrome Web Store

1. Navigate to the `extension/` directory.
2. Ensure all files are present: `manifest.json`, `content.js`, `background.js`, `popup.html`, `popup.js`.
3. Create a ZIP archive:
   ```bash
   cd extension
   # Windows PowerShell
   Compress-Archive -Path * -DestinationPath ../scrollguard-ai-extension.zip
   # macOS / Linux
   zip -r ../scrollguard-ai-extension.zip .
   ```
4. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
5. Click **New Item** and upload the `.zip` file.
6. Fill in the listing details and submit for review.

### Microsoft Edge Add-ons

1. Use the same `.zip` file.
2. Go to the [Edge Add-ons Developer Portal](https://partner.microsoft.com/en-us/dashboard/microsoftedge).
3. Create a new submission and upload the package.

---

## Running Benchmark Evaluation

To evaluate detection accuracy against known scam samples:

```bash
cd backend
python evaluate_engine.py
```

The evaluation script tests against `scam_dataset.json` and reports per-URL results and overall accuracy.

---

## Known Limitations

- **Link-only scanning**: The extension currently scans `<a>` tag `href` attributes only. It does not analyze full DOM paragraph text, image sources, or embedded scripts for malicious content.
- **Auth-path links skipped**: To eliminate false positives, scraped links containing authentication paths (`login`, `signin`, `signup`, `auth`, `oauth`, `register`) are never sent to the backend. The main page URL itself is still always scanned.
- **Same-origin links skipped**: Internal navigation links (same hostname) are intentionally excluded to reduce noise.
- **Backend dependency**: AI analysis requires a running FastAPI backend (local or cloud). The heuristic pre-filter still applies without it.
- **Rate limits**: Batch analysis is capped at 5 concurrent AI calls via semaphore. High-traffic pages with many unique external links may experience slight delays.
- **No persistent threat log**: Flagged links are marked visually on the page but are not stored in a persistent database.

---

## Future Roadmap

### Phase 2 — WhatsApp / Telegram Forwarding Bot

Our planned Phase 2 expansion is a **WhatsApp and Telegram forwarding bot** that protects mobile users from SMS phishing. Users will be able to forward any suspicious message or link to the bot, which will run the same ScrollGuard AI detection pipeline and instantly reply with a threat verdict — extending protection beyond the browser and onto the platforms where most scam messages actually arrive.

### Later Phases

- **Firefox extension**: Port via the WebExtensions API compatibility layer.
- **Mobile browser support**: Kiwi Browser (Android) and Firefox for Android.
- **Full DOM text analysis**: Extend scanning to paragraph text, button labels, and form actions for social-engineering patterns.
- **Persistent threat dashboard**: Store flagged URLs locally with a history view in the popup.
- **User-configurable rules**: Domain whitelists and heuristic sensitivity controls via an options page.

---

## Team Raven

- **Member A** — Backend Architecture & AI API Integration Lead
- **Member B** — Frontend Extension & Dataset Benchmarking Lead

*Developed for the Alibaba Cloud AI Hackathon.*
