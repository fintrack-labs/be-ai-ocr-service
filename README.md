# be-ai-ocr-service

Stateless Fastify service that analyzes transaction images with a vision-capable, OpenAI-compatible chat-completions API. It forwards the caller's bearer token to the finance backend to retrieve that user's accounts and categories, then returns normalized AI output. It does not save images or create transactions.

## Requirements

- Node.js 22 or newer
- npm
- A BE-app URL whose `GET /accounts` and `GET /categories` endpoints accept the forwarded user token
- An OpenAI-compatible vision API endpoint

## Local setup

1. Copy `.env.example` to `.env` and set the BE-app URL, AI API URL, key, and model.
2. Install dependencies with `npm install`.
3. Run tests with `npm test` and the dependency security audit with `npm audit --audit-level=low`.
4. Start the service with `node --env-file=.env src/server.js`.

The API listens on `PORT` (default 3000). Health check: `GET /health`.

## Analyze endpoint

`POST /v1/ocr/analyze`

Headers: `Authorization: Bearer <user-access-token>`

Multipart fields:

- `image`: required JPEG, PNG, or WebP image (10 MiB default maximum)
- `documentType`: optional short document hint
- `locale`: optional language/locale hint

The service does not verify the caller's JWT itself; it forwards the bearer token to the configured BE-app, whose `AuthGuard` performs verification. Confirm that the token issuer/audience are accepted before deployment. The token is never sent to the AI provider.

Set `CORS_ALLOWED_ORIGINS` to the exact frontend origins allowed to call the service, comma-separated when needed. Development defaults to `http://localhost:5173`; production requires explicit HTTPS origins. Wildcard origins are not supported.

The first implementation uses an OpenAI-compatible `/chat/completions` API with JSON response mode and image URL input. Provider compatibility should be verified before configuring a production model.

## Security notes

- Do not commit `.env` or real credentials.
- CI fails on any known npm advisory across production, development, and transitive dependencies.
- Keep `package-lock.json` committed and use `npm ci` in CI/deployments.
- Accounts sent to the AI are minimized: balance is excluded and account numbers are reduced to their last four digits.
- The service returns account/category names from backend candidates, never AI-generated names, and drops IDs that are not in those candidates.
