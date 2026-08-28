---
kind: error_handling
name: Error Handling in ScrollGuard AI — FastAPI HTTPException + Frontend try/catch
category: error_handling
scope:
    - '**'
source_files:
    - backend/main.py
    - extension/popup.js
    - extension/content.js
---

## What system/approach is used

The repository uses a minimal, framework-native error handling approach with no custom error types or centralized error module:

- **Backend (FastAPI)**: Errors are raised as `fastapi.HTTPException` instances with explicit `status_code` and `detail` fields. Validation failures and upstream API errors are caught and re-raised this way so FastAPI serializes them into standard JSON error responses.
- **Frontend (Chrome Extension)**: Errors are handled via JavaScript `try/catch/finally` blocks around `fetch()` calls to the backend, with user-facing feedback delivered through `alert()` dialogs and UI state resets.
- There is **no** custom exception hierarchy, no global exception handler middleware beyond FastAPI's built-in one, no structured logging of errors, and no `panic`/`recover` equivalent (Python exceptions are not caught globally).

## Key files and packages

- `backend/main.py` — The only backend entry point; defines all error paths.
- `extension/popup.js` — Handles network errors when calling the backend from the extension popup.
- `extension/content.js` — Performs local DOM scanning; contains no external I/O, so it has no meaningful error propagation path.

## Architecture and conventions

### Backend (`main.py`)

1. **Startup failure**: Missing `DASHSCOPE_API_KEY` causes an immediate `RuntimeError` at import time (line 12–13). This is a process-level failure that prevents the server from starting.
2. **Request validation**: The `/analyze` endpoint explicitly checks for missing input and raises `HTTPException(status_code=400, detail="Provide at least a URL or text to analyze.")` — a client-error response.
3. **Upstream/API errors**: The call to Alibaba Cloud Qwen (`client.chat.completions.create`) is wrapped in a `try/except` block that catches:
   - `json.JSONDecodeError` → `HTTPException(status_code=500, detail="Failed to parse structured response from AI model.")`
   - A bare `Exception` → `HTTPException(status_code=500, detail=str(e))`, which leaks the raw exception message to the caller.
4. **CORS**: A permissive `CORSMiddleware` (`allow_origins=["*"]`) is configured so the browser extension can reach the backend without CORS-related errors blocking requests.
5. **No global exception handler**: There is no `@app.exception_handler` registered; FastAPI's default exception handler is relied upon to convert `HTTPException` instances into JSON responses.

### Frontend (`popup.js`)

1. **Network error path**: The fetch to `http://127.0.0.1:8000/analyze` is wrapped in `try/catch`. On failure, `alert("Error connecting to backend server. Make sure Uvicorn is running!")` is shown to the user.
2. **UI state recovery**: The `finally` block always restores the button text and re-enables it, ensuring the UI remains usable after both success and failure paths.
3. **No structured error display**: Error details from the backend response body are not surfaced to the user — only a generic alert is shown.
4. **Content script (`content.js`)**: Contains no network calls or async operations; errors here would be silent JS exceptions with no user-visible handling.

## Conventions and constraints observed

- **Client vs. server error distinction**: Client-side validation errors use HTTP 400; server-side / upstream failures use HTTP 500. This is the only status-code convention in the codebase.
- **Human-readable messages**: All `HTTPException.detail` values are plain English strings intended for end users, not machine-readable codes.
- **No retry or timeout logic**: Network calls have no retry, backoff, or timeout configuration; failures surface immediately.
- **No structured error objects**: Responses do not include a unified `{code, message}` envelope — the frontend reads `data.status`, `data.risk_score`, etc., directly from the parsed JSON.
- **No logging**: There are no `logging` calls anywhere in the codebase; errors are surfaced only via HTTP responses and `alert()` dialogs.
- **Bare `except Exception`**: The catch-all `except Exception as e` in `main.py` swallows all unexpected exceptions and forwards them as 500s, which means any future unhandled exception will still produce a valid HTTP response rather than crashing the request thread.