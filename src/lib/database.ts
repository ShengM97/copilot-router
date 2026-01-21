import sql from "mssql"
import consola from "consola"

// SQL Server configuration for Azure AD Default authentication
const sqlConfig: sql.config = {
  server: process.env.DB_SERVER || "adsai.database.windows.net",
  database: process.env.DB_DATABASE || "SmartRepo_test",
  options: {
    encrypt: true, // Required for Azure
    trustServerCertificate: false,
  },
  authentication: {
    type: "azure-active-directory-default",
    options: {}
  }
}

let pool: sql.ConnectionPool | null = null

/**
 * Initialize database connection and create tables if not exist
 */
export async function initializeDatabase(): Promise<void> {
  try {
    consola.info(`Connecting to ${sqlConfig.server}/${sqlConfig.database}...`)
    pool = await sql.connect(sqlConfig)
    consola.success("Connected to SQL Server")

    // Create tokens table if not exists
    // Note: username is unique (one token per user), github_token is not unique (can be updated)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='github_tokens' AND xtype='U')
      CREATE TABLE github_tokens (
        id INT IDENTITY(1,1) PRIMARY KEY,
        github_token NVARCHAR(500) NOT NULL,
        username NVARCHAR(100) UNIQUE,
        copilot_token NVARCHAR(MAX),
        copilot_token_expires_at DATETIME,
        account_type NVARCHAR(50) DEFAULT 'individual',
        is_active BIT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE()
      )
    `)

    // Drop old unique constraint on github_token if exists and add on username
    await pool.request().query(`
      BEGIN TRY
        -- Try to drop the old unique constraint on github_token
        DECLARE @constraintName NVARCHAR(200)
        SELECT @constraintName = name FROM sys.key_constraints 
        WHERE parent_object_id = OBJECT_ID('github_tokens') 
        AND type = 'UQ' 
        AND OBJECT_NAME(parent_object_id) = 'github_tokens'
        AND EXISTS (
          SELECT 1 FROM sys.index_columns ic 
          INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE ic.object_id = OBJECT_ID('github_tokens') AND c.name = 'github_token'
        )
        IF @constraintName IS NOT NULL
          EXEC('ALTER TABLE github_tokens DROP CONSTRAINT ' + @constraintName)
      END TRY
      BEGIN CATCH
        -- Ignore errors
      END CATCH
    `)

    consola.success("Database tables initialized")
  } catch (error) {
    consola.error("Failed to connect to SQL Server:", error)
    throw error
  }
}

/**
 * Get database connection pool
 */
export function getPool(): sql.ConnectionPool {
  if (!pool) {
    throw new Error("Database not initialized")
  }
  return pool
}

/**
 * Token record from database
 */
export interface TokenRecord {
  id: number
  github_token: string
  username: string | null
  copilot_token: string | null
  copilot_token_expires_at: Date | null
  account_type: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

/**
 * Get all active tokens from database
 */
export async function getAllTokens(): Promise<TokenRecord[]> {
  const pool = getPool()
  const result = await pool.request().query<TokenRecord>(`
    SELECT * FROM github_tokens WHERE is_active = 1
  `)
  return result.recordset
}

/**
 * Get a specific token by ID
 */
export async function getTokenById(id: number): Promise<TokenRecord | null> {
  const pool = getPool()
  const result = await pool.request()
    .input("id", sql.Int, id)
    .query<TokenRecord>(`SELECT * FROM github_tokens WHERE id = @id`)
  return result.recordset[0] || null
}

/**
 * Get a token by GitHub token value
 */
export async function getTokenByGithubToken(githubToken: string): Promise<TokenRecord | null> {
  const pool = getPool()
  const result = await pool.request()
    .input("github_token", sql.NVarChar, githubToken)
    .query<TokenRecord>(`SELECT * FROM github_tokens WHERE github_token = @github_token`)
  return result.recordset[0] || null
}

/**
 * Save a new GitHub token to database (or update existing by username)
 */
export async function saveToken(
  githubToken: string,
  username?: string,
  accountType: string = "individual"
): Promise<number> {
  const pool = getPool()
  const result = await pool.request()
    .input("github_token", sql.NVarChar, githubToken)
    .input("username", sql.NVarChar, username || null)
    .input("account_type", sql.NVarChar, accountType)
    .query(`
      MERGE github_tokens AS target
      USING (SELECT @username AS username) AS source
      ON target.username = source.username
      WHEN MATCHED THEN
        UPDATE SET github_token = @github_token, account_type = @account_type, is_active = 1, updated_at = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (github_token, username, account_type) VALUES (@github_token, @username, @account_type)
      OUTPUT inserted.id;
    `)
  return result.recordset[0]?.id
}

/**
 * Update Copilot token for a GitHub token
 */
export async function updateCopilotToken(
  id: number,
  copilotToken: string,
  expiresAt: Date
): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input("id", sql.Int, id)
    .input("copilot_token", sql.NVarChar, copilotToken)
    .input("expires_at", sql.DateTime, expiresAt)
    .query(`
      UPDATE github_tokens 
      SET copilot_token = @copilot_token, 
          copilot_token_expires_at = @expires_at,
          updated_at = GETDATE()
      WHERE id = @id
    `)
}

/**
 * Update GitHub token for an existing entry
 */
export async function updateGithubToken(
  id: number,
  githubToken: string
): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input("id", sql.Int, id)
    .input("github_token", sql.NVarChar, githubToken)
    .query(`
      UPDATE github_tokens 
      SET github_token = @github_token, 
          is_active = 1,
          updated_at = GETDATE()
      WHERE id = @id
    `)
}

/**
 * Deactivate a token
 */
export async function deactivateToken(id: number): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input("id", sql.Int, id)
    .query(`UPDATE github_tokens SET is_active = 0, updated_at = GETDATE() WHERE id = @id`)
}

/**
 * Delete a token
 */
export async function deleteToken(id: number): Promise<void> {
  const pool = getPool()
  await pool.request()
    .input("id", sql.Int, id)
    .query(`DELETE FROM github_tokens WHERE id = @id`)
}

/**
 * Delete all tokens (for cleanup)
 */
export async function deleteAllTokens(): Promise<number> {
  const pool = getPool()
  const result = await pool.request().query(`DELETE FROM github_tokens`)
  return result.rowsAffected[0] || 0
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.close()
    pool = null
    consola.info("Database connection closed")
  }
}
