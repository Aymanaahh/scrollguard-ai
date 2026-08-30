# ScrollGuard AI

> **Real-Time AI-Powered Link Safety & Scam Detection Engine**
> Built for the Alibaba Cloud AI Hackathon by **Team Raven**

---

ScrollGuard AI is an intelligent browser security extension backed by an async FastAPI engine. It **automatically** scans every external link on every page you visit — including dynamically injected links from infinite-scroll feeds — and flags phishing attempts, fraudulent domains, deceptive giveaways, and credential-harvesting schemes **inline**, right where they appear.

---

## Key Features

### Real-Time Auto-Scan (Zero-Click Protection)
- **No manual trigger required.** Content script activates on page load and scans all `<a>` tags immediately.
- **MutationObserver** detects dynamically injected links (infinite scroll, AJAX inserts, SPA route changes) and scans them automatically with 300ms debouncing.
- **Dual deduplication**: `Set<string>` for URL-level dedup + `WeakSet` for element-level dedup (GC-safe).

### Inline Visual Marking
- **Dangerous** links: 3px solid red outline + red badge
- **Suspicious** links: 3px solid amber outline + amber badge
- Marks appear directly next to the offending link — no separate popup needed to identify threats.

### Two-Stage Analysis Pipeline
1. **Heuristic pre-filter** (8 rules): Suspicious TLDs, URL shorteners, deep subdomains, hyphen-heavy domains, typosquatting patterns, path/domain keywords, missing HTTPS.
2. **Qwen LLM deep analysis**: URLs that pass the heuristic are forwarded to Alibaba Cloud's `qwen3.7-plus` model for contextual threat assessment.

### Reduced False-Positive Rate
- Brand-specific typosquatting patterns (e.g., `g00gl`, `paypa1`) replace naive regex that previously flagged legitimate domains like `google.com`.
- Domain-only vs. path-only keyword matching prevents false matches on URL path segments.

### Modernized Popup Dashboard
- Persistent "Scanning automatically in background..." status banner with animated pulse indicator.
- Live scan statistics (links scanned, links flagged) persisted via `chrome.storage.local`.
- Clean, informative UI — no action buttons needed.

### Async FastAPI Backend
- `asyncio.gather()` + `asyncio.Semaphore(5)` for concurrent batch processing with rate limiting.
- AsyncOpenAI client for non-blocking LLM calls.
- Cloud-ready: binds to `0.0.0.0`, port configurable via `PORT` environment variable.

---

## Architecture & Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.12, FastAPI, Uvicorn, Pydantic, AsyncOpenAI |
| **AI Engine** | Alibaba Cloud DashScope API (`qwen3.7-plus`) |
| **Extension** | Chrome Manifest V3, JavaScript (IIFE), HTML5, CSS3 |
| **Deployment** | Procfile, cloud-compatible Uvicorn binding |

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Tab                          │
│                                                         │
│  ┌───────────┐    querySelectorAll / MutationObserver   │
│  │ content.js │ ──────────────────────────────────────► │
│  └─────┬─────┘                                         │
│        │ chrome.runtime.sendMessage                     │
│        ▼                                                │
│  ┌──────────────┐                                       │
│  │ background.js │  (Service Worker – CORS bypass)      │
│  └──────┬───────┘                                       │
│         │ fetch()                                       │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────┐
│       FastAPI Backend (Uvicorn)      │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │ Heuristic │───►│ Qwen LLM     │  │
│  │ Pre-filter│    │ (if needed)  │  │
│  └──────────┘    └───────────────┘  │
│                                     │
│  Returns: { status, score,          │
│            explanation, reasons }   │
└─────────────────────────────────────┘
```

---

## Screenshots & Data Flow

### Popup UI
![Popup Dashboard](docs/screenshots/popup-dashboard.png)
*The modernized popup showing auto-scan status, live statistics, and active protection indicator.*

### Inline Link Highlights
![Inline Warnings](docs/screenshots/inline-warnings.png)
*Dangerous (red) and Suspicious (amber) inline markings on a social media feed.*

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
5. Click **New Item** → upload the `.zip` file.
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
- **Same-origin links skipped**: Internal navigation links (same hostname) are intentionally excluded to reduce noise, which means on-site phishing elements would not be flagged.
- **Backend dependency**: The extension requires a running FastAPI backend (local or cloud) for AI analysis. Without it, only the heuristic pre-filter results are applied.
- **Rate limits**: Batch analysis is capped at 5 concurrent AI calls via semaphore. High-traffic pages with many unique external links may experience slight delays.
- **No persistent threat log**: Flagged links are marked visually on the page but are not stored in a persistent database or user-accessible history.

---

## Future Work

- **Firefox Extension**: Port the extension to Firefox using the WebExtensions API (manifest compatibility layer).
- **Mobile Browser Support**: Explore Kiwi Browser (Android) and Firefox for Android extension support for mobile protection.
- **Full DOM Text Analysis**: Extend scanning beyond `<a>` tags to analyze surrounding paragraph text, button labels, and form actions for social engineering patterns.
- **Persistent Threat Dashboard**: Store flagged URLs in a local database and provide a history view in the popup.
- **User-Configurable Rules**: Allow users to whitelist domains or adjust heuristic sensitivity via an options page.
- **WebAssembly Heuristics**: Compile the heuristic engine to WASM for client-side-only fast scanning without backend roundtrips.

---

## Team Raven

- **Member A** — Backend Architecture & AI API Integration Lead
- **Member B** — Frontend Extension & Dataset Benchmarking Lead

*Developed for the Alibaba Cloud AI Hackathon.*
