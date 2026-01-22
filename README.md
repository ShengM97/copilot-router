# Copilot Router

GitHub Copilot API with OpenAI, Anthropic, and Gemini compatibility. Supports **multiple GitHub tokens** with load balancing and SQL Server storage.

## Features

- **Multi-token support**: Add multiple GitHub accounts for load balancing
- **SQL Server storage**: Persist tokens across restarts
- **VSCode-style login**: Use device code flow to authenticate
- **Load balancing**: Randomly distribute requests across active tokens
- **OpenAI, Anthropic, and Gemini compatibility**: Use familiar APIs

## Setup

### 1. Configure SQL Server

Copy the example environment file and configure your SQL Server connection:

```bash
cp .env.example .env
```

Edit `.env` with your SQL Server credentials:

```env
DB_SERVER=localhost
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=your_password_here
DB_NAME=copilot_router
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
PORT=4242
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

```bash
npm run dev
```

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
    "interval": 5,
    "expires_in": 900
  }'
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

**Refresh all tokens**:
```bash
curl -X POST http://localhost:4242/auth/refresh
```

## API Endpoints

### OpenAI-Compatible

- `POST /v1/chat/completions` - Chat completion (load balanced)
- `GET /v1/models` - List models
- `GET /v1/models?grouped=true` - List models grouped by token
- `POST /v1/embeddings` - Create embeddings (load balanced)

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
- `GET /usage` - Get usage stats
- `GET /usage?grouped=true` - Get usage grouped by token
- `GET /quota` - Get quota for all tokens

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

For multi-token setups, you can view models and usage grouped by token:

```bash
# Models grouped by token
curl "http://localhost:4242/v1/models?grouped=true"

# Usage grouped by token  
curl "http://localhost:4242/usage?grouped=true"

# Quota for all tokens
curl "http://localhost:4242/quota"
```

## Database Schema

The system automatically creates a `github_tokens` table:

```sql
CREATE TABLE github_tokens (
  id INT IDENTITY(1,1) PRIMARY KEY,
  github_token NVARCHAR(500) NOT NULL UNIQUE,
  username NVARCHAR(100),
  copilot_token NVARCHAR(MAX),
  copilot_token_expires_at DATETIME,
  account_type NVARCHAR(50) DEFAULT 'individual',
  is_active BIT DEFAULT 1,
  created_at DATETIME DEFAULT GETDATE(),
  updated_at DATETIME DEFAULT GETDATE()
)
```

## License

MIT
