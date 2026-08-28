---
kind: dependency_management
name: No Formal Dependency Manifest — Inline pip Install and Vendored Extension
category: dependency_management
scope:
    - '**'
source_files:
    - README.md
    - backend/main.py
    - backend/evaluate_engine.py
    - backend/.env.example
    - extension/manifest.json
---

## What system/approach is used

This repository does **not** use a formal Python dependency management tool (no `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`, `poetry.lock`, or `conda` environment file). Dependencies are declared inline in the project's `README.md` installation instructions as a single `pip install` command. The Chrome extension side has no Node.js/JavaScript package manager either — it ships as raw JavaScript/HTML/CSS files with no `package.json`.

## Key files and packages

- **Backend dependencies** (declared in `README.md`, line 103): `fastapi`, `uvicorn`, `openai`, `python-dotenv`, `pydantic`, `requests`. These are imported directly by:
  - `backend/main.py` — imports `fastapi`, `pydantic`, `dotenv`, `openai`
  - `backend/evaluate_engine.py` — imports `requests`
- **Runtime configuration**: `backend/.env` (actual secrets) and `backend/.env.example` (template); `.gitignore` excludes `.env` so API keys are not committed.
- **Extension assets**: `extension/manifest.json`, `extension/content.js`, `extension/popup.html`, `extension/popup.js` — no package manifest, no bundler, no transpiler.

## Architecture and conventions

- **Flat backend layout**: All Python source lives directly under `backend/`; there is no virtual environment committed to the repo, and no vendored `site-packages` directory. Users create their own environment and run `pip install` manually per the README.
- **External service dependency**: The only runtime third-party SDK is Alibaba Cloud's DashScope OpenAI-compatible client (`openai` package configured with `base_url="https://dashscope-intl.aliuncs.com/compatible-mode/v1"`), authenticated via the `DASHSCOPE_API_KEY` environment variable loaded from `.env`.
- **Extension is self-contained**: The browser extension makes HTTP calls against the local FastAPI server at `http://127.0.0.1:8000` using the built-in `fetch` API; it declares no external JS libraries.

## Conventions and constraints

- **No lockfile exists**: There is no `requirements.txt`, `poetry.lock`, `Pipfile.lock`, or equivalent. This means dependency versions are not pinned and can drift between installations unless users pin them themselves.
- **Single-command install**: The README prescribes one `pip install fastapi uvicorn openai python-dotenv pydantic requests` command — all dependencies are installed together without version specifiers.
- **Secrets via `.env`**: Sensitive configuration (the DashScope API key) is read through `python-dotenv` from a `.env` file that is gitignored; the example template is provided as `.env.example`.
- **No private registry or vendoring**: No `pip.conf`, `~/.pip/pip.conf`, `PYPI_URL`, `GOPRIVATE`, or vendored third-party code is present. All packages are expected to be pulled from PyPI.
- **Extension has no build step**: The `extension/` folder contains plain source files loaded unpacked into Chrome/Edge via Developer Mode — no npm/yarn/pnpm workflow, no bundling, no minification.