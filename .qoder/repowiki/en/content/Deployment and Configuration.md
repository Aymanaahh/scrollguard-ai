# Deployment and Configuration

<cite>
**Referenced Files in This Document**
- [backend/main.py](file://backend/main.py)
- [README.md](file://README.md)
- [backend/evaluate_engine.py](file://backend/evaluate_engine.py)
- [extension/manifest.json](file://extension/manifest.json)
- [extension/popup.js](file://extension/popup.js)
</cite>

## Table of Contents
1. Introduction
2. Project Structure
3. Core Components
4. Architecture Overview
5. Detailed Component Analysis
6. Dependency Analysis
7. Performance Considerations
8. Troubleshooting Guide
9. Conclusion
10. Appendices

## Introduction
This document provides production-focused deployment guidance for the ScrollGuard AI application, including containerization, cloud deployment options, environment configuration management, CORS setup, secure API key handling, monitoring and logging, scaling strategies, operational procedures, configuration templates, CI/CD automation, troubleshooting, and performance optimization. The backend is a FastAPI service that calls an external LLM via an OpenAI-compatible endpoint; the frontend is a browser extension that communicates with the backend over HTTP.

## Project Structure
The repository contains:
- Backend (FastAPI): Python service exposing endpoints for content analysis and integrating with an external LLM provider.
- Browser Extension: Manifest V3 extension that sends page context to the backend and displays results.
- Evaluation script: A simple benchmarking tool that calls the backend against a dataset.

```mermaid
graph TB
subgraph "Browser"
EXT["Chrome/Edge Extension"]
end
subgraph "Backend"
APP["FastAPI App"]
CORS["CORS Middleware"]
ROUTES["Endpoints: /, /analyze"]
ENV["Environment Loader"]
LLM["OpenAI-Compatible Client"]
end
EXT --> |"HTTP POST /analyze"| APP
APP --> CORS
APP --> ROUTES
ROUTES --> ENV
ROUTES --> LLM
```

**Diagram sources**
- [backend/main.py:20-29](file://backend/main.py#L20-L29)
- [backend/main.py:60-92](file://backend/main.py#L60-L92)
- [extension/popup.js:20-29](file://extension/popup.js#L20-L29)

**Section sources**
- [backend/main.py:1-92](file://backend/main.py#L1-L92)
- [README.md:45-141](file://README.md#L45-L141)
- [extension/manifest.json:1-20](file://extension/manifest.json#L1-L20)
- [extension/popup.js:1-46](file://extension/popup.js#L1-L46)

## Core Components
- FastAPI application: Defines routes and request/response models, configures CORS, and integrates with the LLM client.
- Environment configuration: Loads secrets from environment variables using dotenv at startup.
- External dependency: OpenAI-compatible client configured to call the DashScope endpoint.
- Browser extension: Sends requests to the backend and renders risk assessments.

Key responsibilities:
- Input validation and error handling on the analyze endpoint.
- Secure retrieval of API keys from environment variables.
- CORS configuration to allow extension communication.

**Section sources**
- [backend/main.py:1-92](file://backend/main.py#L1-L92)
- [README.md:99-131](file://README.md#L99-L131)
- [extension/popup.js:20-29](file://extension/popup.js#L20-L29)

## Architecture Overview
The system consists of a FastAPI backend and a browser extension. The extension posts page data to the backend’s /analyze endpoint. The backend validates input, constructs a prompt, calls the LLM provider, parses structured JSON output, and returns it to the caller.

```mermaid
sequenceDiagram
participant Ext as "Extension"
participant API as "FastAPI App"
participant LLM as "LLM Provider"
Ext->>API : POST /analyze {url, text, platform}
API->>API : Validate payload
API->>LLM : chat.completions.create(model="qwen3.7-plus", messages)
LLM-->>API : Structured JSON response
API->>API : Parse and validate JSON
API-->>Ext : {status, risk_score, explanation, flagged_reasons}
```

**Diagram sources**
- [backend/main.py:64-92](file://backend/main.py#L64-L92)
- [extension/popup.js:20-29](file://extension/popup.js#L20-L29)

## Detailed Component Analysis

### Backend Service (FastAPI)
- Application initialization and version metadata.
- CORS middleware enabling cross-origin requests from the extension.
- Request/response schemas for typed validation.
- Endpoints:
  - GET /: Health/root indicator.
  - POST /analyze: Validates input, calls LLM, parses JSON, returns structured result.
- Error handling:
  - Returns 400 when no URL or text provided.
  - Returns 500 on parsing failures or unexpected exceptions.

Operational notes:
- Requires DASHSCOPE_API_KEY at startup; missing key raises a runtime error.
- Uses dotenv to load environment variables from .env.

```mermaid
flowchart TD
Start(["Request to /analyze"]) --> Validate["Validate payload<br/>URL or Text required"]
Validate --> |Missing| Err400["Return 400"]
Validate --> |OK| CallLLM["Call LLM chat.completions"]
CallLLM --> Parse["Parse JSON response"]
Parse --> |Invalid| Err500["Return 500 parse error"]
Parse --> |Valid| Return["Return structured result"]
```

**Diagram sources**
- [backend/main.py:64-92](file://backend/main.py#L64-L92)

**Section sources**
- [backend/main.py:1-92](file://backend/main.py#L1-L92)

### Browser Extension
- Manifest V3 extension with permissions for active tab and scripting.
- Popup UI triggers analysis by posting to the backend’s /analyze endpoint.
- Displays status, risk score, and explanation returned by the backend.

**Section sources**
- [extension/manifest.json:1-20](file://extension/manifest.json#L1-L20)
- [extension/popup.js:1-46](file://extension/popup.js#L1-L46)

### Evaluation Script
- Reads scam_dataset.json and calls the running backend to evaluate detection accuracy.
- Useful for regression testing and model behavior checks in CI.

**Section sources**
- [backend/evaluate_engine.py:1-49](file://backend/evaluate_engine.py#L1-L49)
- [README.md:175-189](file://README.md#L175-L189)

## Dependency Analysis
External dependencies:
- FastAPI and Uvicorn for serving the API.
- OpenAI SDK configured to use DashScope base URL.
- python-dotenv for loading environment variables.
- Pydantic for request/response validation.

Runtime requirements:
- Python 3.10+ (per README).
- Network access to the LLM provider endpoint.

Configuration surface:
- DASHSCOPE_API_KEY must be set before startup.
- CORS origins can be restricted to specific domains in production.

```mermaid
graph LR
PY["Python Runtime"] --> FASTAPI["FastAPI/Uvicorn"]
FASTAPI --> OPENAI["OpenAI SDK"]
OPENAI --> DASHSCOPE["DashScope Endpoint"]
FASTAPI --> DOTENV["python-dotenv"]
FASTAPI --> PYDANTIC["Pydantic"]
```

**Diagram sources**
- [backend/main.py:1-18](file://backend/main.py#L1-L18)
- [README.md:45-55](file://README.md#L45-L55)

**Section sources**
- [backend/main.py:1-18](file://backend/main.py#L1-L18)
- [README.md:45-55](file://README.md#L45-L55)

## Performance Considerations
- Concurrency: Use multiple Uvicorn workers behind a reverse proxy to handle concurrent requests. Tune worker count based on CPU cores and I/O characteristics.
- Timeouts: Configure request timeouts for both the reverse proxy and the application to prevent resource exhaustion during slow LLM responses.
- Caching: Introduce caching for repeated or similar inputs to reduce LLM calls and latency.
- Backpressure: Implement rate limiting at the gateway level to protect the backend and LLM quota.
- Connection reuse: Ensure the HTTP client reuses connections to the LLM provider where supported.
- Monitoring: Track latency, error rates, and throughput to identify bottlenecks.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Missing API key:
  - Symptom: Startup failure due to missing DASHSCOPE_API_KEY.
  - Resolution: Provide the key via environment variables or secret manager injection.
- CORS errors from the extension:
  - Symptom: Browser blocks requests from extension to backend.
  - Resolution: Restrict CORS origins to the exact extension origin(s) used in production.
- Invalid or malformed LLM response:
  - Symptom: 500 error on /analyze due to JSON parse failure.
  - Resolution: Add retries, stricter parsing, and fallback logic; log raw responses for debugging.
- Extension cannot reach backend:
  - Symptom: Popup shows connection error.
  - Resolution: Verify network connectivity, firewall rules, and that the backend is reachable from the browser environment.

Operational checks:
- Health check: Use GET / to verify the service is up.
- Evaluate script: Run evaluation to validate integration with the backend and LLM.

**Section sources**
- [backend/main.py:11-13](file://backend/main.py#L11-L13)
- [backend/main.py:22-29](file://backend/main.py#L22-L29)
- [backend/main.py:89-92](file://backend/main.py#L89-L92)
- [extension/popup.js:39-41](file://extension/popup.js#L39-L41)
- [backend/evaluate_engine.py:1-49](file://backend/evaluate_engine.py#L1-L49)

## Conclusion
ScrollGuard AI’s backend is a lightweight FastAPI service that depends on an external LLM provider. Production deployments should focus on secure secret management, strict CORS configuration, robust error handling, observability, and horizontal scaling. The browser extension remains a thin client that relies on a reliable backend endpoint.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### A. Containerization with Docker
Recommended steps:
- Create a multi-stage Dockerfile:
  - Build stage: Install Python dependencies into a virtual environment.
  - Runtime stage: Copy only necessary artifacts and run Uvicorn with multiple workers.
- Expose port 8000 and configure environment variables via container orchestration or secret managers.
- Use health checks to ensure readiness.

[No sources needed since this section provides general guidance]

### B. Cloud Deployment Options
- AWS:
  - ECS/Fargate or EKS for containerized deployments.
  - ALB/NLB for load balancing and TLS termination.
  - Secrets Manager or SSM Parameter Store for API keys.
- Azure:
  - Container Apps or AKS for orchestration.
  - Application Gateway or Front Door for ingress and security policies.
  - Key Vault for secrets.
- Google Cloud:
  - Cloud Run or GKE for containerized services.
  - Cloud Load Balancing for ingress.
  - Secret Manager for secrets.

[No sources needed since this section provides general guidance]

### C. Environment Configuration Management
- Required variables:
  - DASHSCOPE_API_KEY: Set via environment variables injected by your platform or secret manager.
- Best practices:
  - Never commit secrets to version control.
  - Use per-environment configurations (development, staging, production).
  - Rotate keys regularly and audit access.

**Section sources**
- [backend/main.py:9-13](file://backend/main.py#L9-L13)
- [README.md:109-121](file://README.md#L109-L121)

### D. CORS Configuration for Production
- Current behavior: Allows all origins for development convenience.
- Production recommendation:
  - Restrict allow_origins to known extension origins or domains.
  - Limit allowed methods and headers to the minimum required.
  - Enable credentials only when necessary.

**Section sources**
- [backend/main.py:22-29](file://backend/main.py#L22-L29)

### E. Secure API Key Management
- Use platform-native secret stores:
  - AWS Secrets Manager/SSM, Azure Key Vault, Google Secret Manager.
- Inject secrets at runtime into the container environment.
- Enforce least privilege and rotation policies.

**Section sources**
- [backend/main.py:9-13](file://backend/main.py#L9-L13)

### F. Monitoring and Logging
- Application metrics:
  - Expose Prometheus metrics (e.g., via Starlette middleware) for request counts, latency, and error rates.
- Structured logs:
  - Log request IDs, endpoints, status codes, and error details (sanitized).
- Error tracking:
  - Integrate an error tracking service to capture exceptions and stack traces.
- Audit logging:
  - Record access patterns and security-relevant events for compliance.

[No sources needed since this section provides general guidance]

### G. Scaling Considerations
- Horizontal scaling:
  - Deploy multiple instances behind a load balancer.
  - Scale out based on CPU/memory utilization and request latency.
- Load balancing:
  - Use TCP/HTTP-level load balancers with health checks.
- Database connection pooling:
  - If adding persistent storage later, configure connection pools appropriate for concurrency.

[No sources needed since this section provides general guidance]

### H. Operational Procedures
- Health checks:
  - Implement readiness and liveness probes using GET /.
- Graceful shutdown:
  - Handle SIGTERM to finish in-flight requests before stopping workers.
- Rollback strategies:
  - Use immutable container images and blue/green or rolling updates.
  - Maintain previous versions for quick rollback.

[No sources needed since this section provides general guidance]

### I. Configuration Templates
- Development:
  - Local .env with DASHSCOPE_API_KEY.
  - CORS allows all origins for ease of testing.
- Staging:
  - Restricted CORS origins matching staging extension builds.
  - Secrets injected via platform secret store.
- Production:
  - Strict CORS origins, rate limiting, WAF rules.
  - Secrets managed via secret manager.
  - Observability enabled with metrics, logs, and tracing.

[No sources needed since this section provides general guidance]

### J. CI/CD Automation
- Build pipeline:
  - Lint, test, build container image, push to registry.
- Security scanning:
  - Scan dependencies and container images for vulnerabilities.
- Deployment:
  - Deploy to staging for automated tests, then promote to production with approvals.
- Evaluation:
  - Run backend evaluation script against deployed staging to validate behavior.

**Section sources**
- [backend/evaluate_engine.py:1-49](file://backend/evaluate_engine.py#L1-L49)
- [README.md:175-189](file://README.md#L175-L189)

### K. Troubleshooting Common Deployment Issues
- Startup fails due to missing API key:
  - Ensure secrets are injected correctly into the runtime environment.
- CORS blocked by browsers:
  - Align backend CORS settings with the actual extension origin.
- High latency or timeouts:
  - Increase timeouts at the gateway, add retries, and monitor LLM provider SLAs.
- Extension cannot connect:
  - Verify network policies, DNS resolution, and that the backend is exposed publicly or within the same network.

**Section sources**
- [backend/main.py:11-13](file://backend/main.py#L11-L13)
- [backend/main.py:22-29](file://backend/main.py#L22-L29)
- [extension/popup.js:39-41](file://extension/popup.js#L39-L41)