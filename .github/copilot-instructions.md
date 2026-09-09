# DevSignal AI Copilot Instructions

DevSignal AI is a human-approved AI content and personal-branding platform
for software developers.

## Architecture

- apps/web: Next.js, React, TypeScript and Tailwind CSS
- services/api: Node.js, Express.js, TypeScript and MongoDB
- services/ai-service: Python, FastAPI and OpenAI
- packages/shared: shared TypeScript types and validation contracts
- Phase 2 will add Qdrant
- Phase 3 will add Redis and LangGraph

## Responsibilities

The Next.js frontend must handle presentation and user interaction.

The Express API must own:

- authentication
- authorization
- database operations
- topics
- drafts
- approvals
- scheduling
- communication with the AI service

The FastAPI service must own:

- prompt construction
- OpenAI API communication
- structured AI output
- content safety checks
- AI evaluation in later phases

Do not access MongoDB directly from the Next.js application.

## TypeScript rules

- Enable strict TypeScript.
- Never use `any`.
- Use named types and interfaces.
- Validate external input.
- Use async/await.
- Separate controllers, services, repositories and routes.
- Keep controllers thin.
- Use centralized error handling.
- Never expose stack traces or secrets to clients.

## Security rules

- Never hardcode credentials.
- Read secrets from environment variables.
- Validate request bodies.
- Hash passwords with bcrypt.
- Store authentication tokens securely.
- Use HTTP-only cookies where appropriate.
- Verify resource ownership on every protected operation.
- Do not log passwords, tokens or API keys.

## AI rules

- Generated claims must come only from user-provided information.
- Never invent metrics, employers, projects or experience.
- Require structured model output.
- Validate all model output before returning it.
- Provide exactly three meaningfully different post variations.
- The AI must never publish content automatically.
- Human approval is required before scheduling or publishing.

## Code-generation behavior

Before editing:

1. Explain the proposed implementation.
2. List files that will be created or changed.
3. Do not change unrelated files.
4. Follow the existing architecture.
5. Include loading, success, empty and error states.
6. Add focused tests for important business logic.
7. Explain how to test the completed feature.
