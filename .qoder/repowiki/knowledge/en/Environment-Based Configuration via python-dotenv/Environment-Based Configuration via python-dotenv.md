---
kind: configuration_system
name: Environment-Based Configuration via python-dotenv
category: configuration_system
scope:
    - '**'
source_files:
    - backend/.env
    - backend/.env.example
    - backend/main.py
    - extension/manifest.json
---

## What system/approach is used

The ScrollGuard AI project uses a minimal, file-based configuration approach centered on **environment variables loaded from a `.env` file** using the `python-dotenv` library. There are no YAML/JSON/TOML config files, no dedicated config module, and no runtime configuration server. The only configuration mechanism is:

- A per-environment `.env` file in `backend/`
- A template `.env.example` for new developers
- Direct `os.getenv()` calls at application startup to read secrets

The Chrome extension side has no runtime configuration; its behavior is entirely defined by the static `manifest.json` (Manifest V3) and bundled scripts.

## Key files and packages

- `backend/.env` — active secret store containing `DASHSCOPE_API_KEY` (the Alibaba Cloud DashScope/Qwen API key). This file should not be committed to version control.
- `backend/.env.example` — template showing the required environment variable name and placeholder value. Serves as the contract for what env vars must be provided.
- `backend/main.py` — FastAPI entry point that loads `.env`, reads `DASHSCOPE_API_KEY`, and raises `RuntimeError` if it is missing. Also hardcodes the OpenAI-compatible base URL (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`) and model name (`qwen3.7-plus`).
- `extension/manifest.json` — Chrome Manifest V3 declaration with permissions (`activeTab`, `scripting`) and content script registration. No external config loading exists in the extension code.

## Architecture and conventions

1. **Single-source-of-truth env var**: The backend expects exactly one environment variable: `DASHSCOPE_API_KEY`. It is the only secret consumed by the service.
2. **Fail-fast startup validation**: In `main.py`, after `load_dotenv()`, the code immediately reads `api_key = os.getenv("DASHSCOPE_API_KEY")` and raises `RuntimeError("DASHSCOPE_API_KEY is not set in environment variables.")` if absent. This means the app will not start without the key configured.
3. **No layered config merging**: There is no fallback chain (e.g., default → env → file), no config schema validation beyond the presence check, and no support for multiple environments (dev/staging/prod) within the same process. Environment switching is done by swapping the `.env` file.
4. **Hardcoded non-secret settings**: Model name (`qwen3.7-plus`) and the DashScope OpenAI-compatible endpoint URL are embedded directly in `main.py`. They are not exposed as configurable values.
5. **Extension-side immutability**: The browser extension carries no runtime configuration. Permissions, content script matches (`<all_urls>`), popup, and content script paths are fixed in `manifest.json` and cannot be changed without repackaging the extension.
6. **CORS policy as deployment config**: CORS is enabled with `allow_origins=["*"]`, `allow_credentials=True`, and wildcard methods/headers. This is a permissive cross-origin policy suitable for local development but would need tightening for production.

## Conventions and constraints

- **Secrets live only in `.env`**: All secrets (currently just the DashScope API key) are stored in `backend/.env`; there is no other secrets manager or encrypted store.
- **Template-driven onboarding**: New contributors copy `backend/.env.example` to `backend/.env` and fill in their own key. The example file documents the exact variable name expected.
- **Startup failure on missing config**: Missing `DASHSCOPE_API_KEY` causes an unhandled `RuntimeError` at import time, preventing the service from running with incomplete configuration.
- **No config schema or defaults**: Beyond the presence check, there is no type coercion, default value, or schema validation for environment variables.
- **No multi-environment support**: There are no separate `.env.dev`, `.env.prod`, or similar files; environment selection is implicit based on which `.env` is present.
- **Extension manifest is the source of truth for extension behavior**: The Chrome extension's capabilities (permissions, content scripts, popup) are fully declared in `manifest.json` and cannot be overridden at runtime.