---
kind: build_system
name: Build & Deployment — Procfile-based PaaS deployment with ad-hoc Docker and manual extension packaging
category: build_system
scope:
    - '**'
source_files:
    - backend/Procfile
    - backend/main.py
    - backend/.env.example
    - extension/manifest.json
    - README.md
---

## What system/approach is used

The project has no formal build system (no Makefile, no `pyproject.toml`, no `requirements.txt`, no CI pipeline). The backend is a Python FastAPI application that is started directly via Uvicorn. Deployment to cloud platforms is driven by a Heroku/Render/Railway-compatible `Procfile`. The README also documents an optional Docker image built from an inline `dockerfile` snippet. The Chrome extension is distributed as an unpacked folder for development and as a manually created ZIP archive for store submission.

## Key files and packages

- `backend/Procfile` — declares the web process: `web: uvicorn main:app --host 0.0.0.0 --port $PORT`.
- `backend/main.py` — FastAPI app entry point; when run as `__main__` it invokes `uvicorn.run("main:app", host="0.0.0.0", port=..., reload=...)` based on the `ENV` environment variable.
- `backend/.env.example` / `backend/.env` — environment configuration loaded via `python-dotenv`; `DASHSCOPE_API_KEY` is required at startup.
- `extension/manifest.json` — Manifest V3 definition declaring permissions, content scripts, background service worker, and popup.
- `README.md` — contains the only build/deployment instructions in the repo (manual `pip install`, `python main.py`, Procfile-based PaaS deploy, inline Dockerfile, ZIP packaging).

## Architecture and conventions

- **Backend runtime**: Uvicorn is both the dev server (`python -m uvicorn main:app --reload`) and the production process manager (via Procfile or direct `python main.py`). There is no separate WSGI/ASGI config file; all runtime flags are passed through CLI arguments or environment variables (`PORT`, `ENV`, `DASHSCOPE_API_KEY`).
- **Cloud readiness**: The app binds to `0.0.0.0` and reads `PORT` from the environment so it works unchanged on Render, Heroku, Railway, Alibaba Cloud ECS, or Function Compute — documented explicitly in the README.
- **Development vs production**: When launched via `__main__`, auto-reload is enabled unless `ENV=production`. The Procfile omits `--reload`, which is the standard convention for production deployments.
- **Extension distribution**: Development uses "Load unpacked" from `extension/`. For store submission the README instructs creating a ZIP of the `extension/` directory contents and uploading it to the Chrome Web Store / Microsoft Edge Add-ons dashboards.
- **Docker (optional)**: The README provides a one-off `FROM python:3.12-slim` Dockerfile snippet that copies `backend/`, installs dependencies with `pip install --no-cache-dir`, exposes port 8000, and runs `python main.py`. It is not checked into the repo as a dedicated file.

## Conventions and constraints

- No dependency manifest file exists; dependencies are installed inline via `pip install fastapi uvicorn openai python-dotenv pydantic requests` (documented in README). This means there is no reproducible lockstep between environments beyond pinning versions externally.
- Secrets are not baked into the image or codebase; `DASHSCOPE_API_KEY` must be supplied as an environment variable at runtime (enforced by a `RuntimeError` if missing in `main.py`).
- The extension's host permission `http://127.0.0.1:8000/*` hard-codes the default local backend URL; switching to a cloud backend requires setting `sg_backendUrl` via `chrome.storage.local` at runtime (documented in README).
- There is no automated test harness invoked by a build step; evaluation is triggered manually via `python evaluate_engine.py` against `scam_dataset.json`.
- Versioning: the FastAPI app declares `version="2.0.0"` in its declaration, and the extension declares `"version": "1.0"` in `manifest.json`; these are independent and not synchronized by any script.