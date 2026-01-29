# Copilot Router

GitHub Copilot API with OpenAI, Anthropic, and Gemini compatibility. Supports **multiple GitHub tokens** with load balancing and SQL Server storage.

## Features

- **Multi-token support**: Add multiple GitHub accounts for load balancing
- **SQL Server storage**: Persist tokens across restarts (supports Azure AD authentication)
- **Memory-only mode**: Works without database configuration
- **GitHub Device Code flow**: Use device code flow to authenticate
- **Web UI**: User-friendly login page for managing tokens
- **Load balancing**: Randomly distribute requests across active tokens
- **OpenAI, Anthropic, and Gemini compatibility**: Use familiar APIs
- **OpenAPI documentation**: Auto-generated API docs at `/openapi.json`

## Quick Start

The fastest way to run Copilot Router without cloning the repository:

```bash
npx copilot-router@latest start
```

With custom port:

```bash
npx copilot-router@latest start --port 8080
```

## Setup (Development)

### 1. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# SQL Server connection string (optional - uses memory mode if not provided)
DB_CONNECTION_STRING=Server=localhost;Database=copilot_router;Authentication=Active Directory Default
PORT=4242
```

**Supported Authentication Types:**
- `Active Directory Default` - Uses system's default Azure AD auth
- `Active Directory Managed Identity` - Uses Azure Managed Identity (requires `User Id` for client-id)

> **Note**: If `DB_CONNECTION_STRING` is not provided, the server runs in memory-only mode. In memory-only mode, the server will automatically detect and use your local `gh auth` token if available.

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

```bash
npm run dev
```

Or for production:

```bash
npm start
```

## Web UI

Access the login UI at `http://localhost:4242/login` to:
- Login via GitHub Device Code flow
- Add tokens directly
- Manage existing tokens

## Authentication

### Method 1: Device Code Flow (Recommended)

1. **Start login**:
```bash
curl -X POST http://localhost:4242/auth/login
```

Response:
```json
{
  "user_code": "ABCD-1234",
  "verification_uri": "https://github.com/login/device",
  "device_code": "...",
  "expires_in": 900,
  "interval": 5
}
```

2. **Visit the URL** and enter the code to authorize.

3. **Complete login**:
```bash
curl -X POST http://localhost:4242/auth/complete \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "...",
    "account_type": "individual"
  }'
```

Response:
```json
{
  "status": "success",
  "id": 1,
  "username": "your-username",
  "account_type": "individual",
  "message": "Successfully logged in as your-username"
}
```

### Method 2: Direct Token Input

If you already have a GitHub token:

```bash
curl -X POST http://localhost:4242/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "github_token": "ghu_xxx...",
    "account_type": "individual"
  }'
```

### Manage Tokens

**List all tokens**:
```bash
curl http://localhost:4242/auth/tokens
```

**Delete a token**:
```bash
curl -X DELETE http://localhost:4242/auth/tokens/1
```

**Delete all tokens**:
```bash
curl -X DELETE http://localhost:4242/auth/tokens/all
```

## API Endpoints

### OpenAI-Compatible

Available at both root (`/`) and versioned (`/v1`) paths:

- `POST /chat/completions` or `POST /v1/chat/completions` - Chat completion (load balanced)
- `GET /models` or `GET /v1/models` - List models
- `GET /models?grouped=true` or `GET /v1/models?grouped=true` - List models grouped by token
- `POST /embeddings` or `POST /v1/embeddings` - Create embeddings (load balanced)

### Anthropic-Compatible

- `POST /v1/messages` - Create message (load balanced)
- `POST /v1/messages/count_tokens` - Count tokens

### Gemini-Compatible

- `POST /v1beta/models/:model:generateContent` - Generate content (load balanced)
- `POST /v1beta/models/:model:streamGenerateContent` - Stream content
- `POST /v1beta/models/:model:countTokens` - Count tokens

### Utility

- `GET /` - Health check with token count
- `GET /token` - List active tokens with Copilot token info
- `GET /login` - Web UI for token management
- `GET /openapi.json` - OpenAPI documentation

### Auth

- `POST /auth/login` - Start device code flow
- `POST /auth/complete` - Complete device code authentication
- `GET /auth/tokens` - List all tokens with statistics
- `POST /auth/tokens` - Add token directly
- `DELETE /auth/tokens/:id` - Delete a specific token
- `DELETE /auth/tokens/all` - Delete all tokens

## Load Balancing

All API calls (`/chat/completions`, `/embeddings`, `/messages`, `:generateContent`) automatically use **random token selection** for load balancing. Each request will use a different token from your pool of active tokens.

### Request Statistics

View per-token statistics:

```bash
curl http://localhost:4242/auth/tokens
```

Response includes:
- `request_count` - Total requests made with this token
- `error_count` - Number of errors
- `last_used` - Last time the token was used

## Grouped Display

For multi-token setups, you can view models grouped by token:

```bash
# Models grouped by token
curl "http://localhost:4242/v1/models?grouped=true"
```

## Database Schema

When using SQL Server, the system automatically creates a `GithubTokens` table:

```sql
CREATE TABLE GithubTokens (
  id INT IDENTITY(1,1) PRIMARY KEY,
  Token NVARCHAR(500) NOT NULL,
  UserName NVARCHAR(100) UNIQUE,
  AccountType NVARCHAR(50) DEFAULT 'individual',
  IsActive BIT DEFAULT 1
)
```

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: [Hono](https://hono.dev/) with OpenAPI support
- **Database**: Microsoft SQL Server (optional)
- **Build Tool**: TSX for development, TypeScript for production

## License

MIT
