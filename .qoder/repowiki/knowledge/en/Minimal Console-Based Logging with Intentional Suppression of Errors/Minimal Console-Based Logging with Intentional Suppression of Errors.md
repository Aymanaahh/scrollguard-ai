---
kind: logging_system
name: Minimal Console-Based Logging with Intentional Suppression of Errors
category: logging_system
scope:
    - '**'
source_files:
    - backend/main.py
    - backend/evaluate_engine.py
    - backend/test_qwen.py
    - backend/test_scan.py
    - extension/background.js
    - extension/content.js
---

This repository does not implement a structured logging system. There is no dedicated logger framework, log configuration file, log-level management, or centralized logging module in either the Python backend or the Chrome extension.

**Backend (FastAPI)**
- The FastAPI service (`backend/main.py`) has no `logging` import and emits no application logs. All runtime output comes from ad-hoc `print()` calls in test/evaluation scripts (`evaluate_engine.py`, `test_qwen.py`, `test_scan.py`) used for manual CLI diagnostics — e.g., connection errors, HTTP status codes, classification reports, and confusion matrices. These are development-only helpers, not part of the running server.
- Uvicorn is started via `uvicorn.run(...)` with no custom access loggers or request interceptors; request/response logging relies entirely on Uvicorn's default console output.
- Errors during LLM calls are surfaced to clients as `HTTPException(500, detail=...)` rather than being logged to a file or external sink.

**Chrome Extension**
- The background service worker (`extension/background.js`) explicitly avoids using `console.error`. Its comments state that timeouts and network failures resolve gracefully — "no console.error, no unhandled rejection, so Chrome never raises the extension error badge". Failures return a `{ success: false, error, status: "Safe" }` fallback object instead of throwing.
- The content script (`extension/content.js`) uses exactly one `console.log` call at startup to print a single status line: `[ScrollGuard AI] Zero-click scanner active on <hostname>`. This is documented as "the only non-error console output".
- No other `console.*` calls exist in the extension codebase beyond the intentional suppression of `console.error`.

**Conventions observed**
- Backend diagnostic output is restricted to standalone test/evaluation scripts and uses plain `print()` — there is no shared logging utility.
- Frontend deliberately suppresses error console output to keep the Chrome extension error badge clean; operational issues are communicated back to callers via structured fallback objects rather than logs.
- There is no log rotation, structured JSON logging, correlation IDs, log levels, or external sinks (file, syslog, APM) anywhere in the codebase.