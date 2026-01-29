# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Copilot Router is a proxy server that exposes GitHub Copilot API through OpenAI, Anthropic, and Gemini-compatible interfaces. It supports multiple GitHub tokens with load balancing and optional SQL Server storage.

## Common Commands

```bash
npm run dev          # Start development server with hot reload (tsx watch)
npm start            # Start server without hot reload
npm run typecheck    # Run TypeScript type checking
npm run build        # Build for production (tsc + tsc-alias + post-build script)
```

## Architecture

### Entry Points
- `src/main.ts` - Server initialization, middleware setup, route registration
- `src/cli.ts` - CLI entry point for `npx copilot-router start`

### Core Libraries (`src/lib/`)
- `token-manager.ts` - Singleton `TokenManager` class managing GitHub tokens with load balancing (random selection). Handles both database-backed and memory-only modes
- `database.ts` - SQL Server connection using `mssql` package with Azure AD authentication support
- `api-config.ts` - GitHub Copilot API configuration (base URLs, headers, versions)
- `auth-middleware.ts` - API key authentication supporting OpenAI (`Bearer`), Anthropic (`x-api-key`), and Gemini (`x-goog-api-key`) header formats

### Route Structure (`src/routes/`)
Each API compatibility layer has its own directory:
- `openai/` - OpenAI-compatible endpoints (`/chat/completions`, `/models`, `/embeddings`)
- `anthropic/` - Anthropic-compatible endpoints (`/messages`, `/messages/count_tokens`) with request/response translation
- `gemini/` - Gemini-compatible endpoints (`/models/:model:generateContent`) with translation layer
- `auth/` - Token management endpoints (device code flow, token CRUD)
- `utility/` - Health check and utility endpoints

### Translation Pattern
Anthropic and Gemini routes translate requests to OpenAI format, call GitHub Copilot API, then translate responses back. Key files:
- `routes/anthropic/translation.ts` - Anthropic <-> OpenAI format conversion
- `routes/anthropic/stream-translation.ts` - Streaming chunk translation
- `routes/gemini/translation.ts` - Gemini <-> OpenAI format conversion

### GitHub Services (`src/services/`)
- `github/` - GitHub OAuth device flow, user info retrieval
- `copilot/` - Copilot API calls (chat completions, embeddings, models)

## Key Patterns

### Path Aliases
Uses `~/` alias for `src/` directory (configured in tsconfig.json, resolved by tsc-alias at build time).

### Environment Modes
- **Development** (default): All endpoints enabled including `/login`, `/auth/*`, `/openapi.json`
- **Production** (`ENVIRONMENT=Production`): Auth and docs endpoints disabled

### Token Loading Priority
1. If `DB_CONNECTION_STRING` is set: loads from SQL Server
2. Otherwise: attempts to use local `gh auth token` from GitHub CLI
