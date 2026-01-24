import sql from "mssql"
import consola from "consola"

interface DbConnectionConfig {
  server: string
  database: string
  authentication: string
  userId?: string
}

/**
 * Parse connection string to extract server, database, authentication type and user id
 * Supported formats:
 * - Server=xxx;Database=xxx;Authentication=Active Directory Default
 * - Server=xxx;Database=xxx;User Id=xxx;Authentication=Active Directory Managed Identity
 */
function parseConnectionString(connectionString: string): DbConnectionConfig | null {
  if (!connectionString) return null
  
  const serverMatch = connectionString.match(/Server=([^;]+)/i)
  const databaseMatch = connectionString.match(/Database=([^;]+)/i)
  const authMatch = connectionString.match(/Authentication=([^;]+)/i)
  const userIdMatch = connectionString.match(/User Id=([^;]+)/i)
  
  if (!serverMatch || !databaseMatch) return null
  
  return {
    server: serverMatch[1],
    database: databaseMatch[1],
    authentication: authMatch?.[1] || "Active Directory Default",
    userId: userIdMatch?.[1]
  }
}

/**
 * Build mssql authentication config based on connection string authentication type
 */
function buildAuthConfig(dbConfig: DbConnectionConfig): sql.config["authentication"] {
  const authType = dbConfig.authentication.toLowerCase()
  
  // Active Directory Managed Identity
  if (authType.includes("managed identity")) {
    return {
      type: "azure-active-directory-msi-app-service",
      options: {
        clientId: dbConfig.userId
      }
    }
  }
  
  // Active Directory Default (default fallback)
  return {
    type: "azure-active-directory-default",
    options: {}
  }
}

// Parse connection string
const dbConfig = parseConnectionString(process.env.DB_CONNECTION_STRING || "")

// SQL Server configuration
const sqlConfig: sql.config = {
  server: dbConfig?.server || "",
  database: dbConfig?.database || "",
  options: {
    encrypt: true, // Required for Azure
    trustServerCertificate: false,
  },
  authentication: dbConfig ? buildAuthConfig(dbConfig) : undefined
}

let pool: sql.ConnectionPool | null = null

/**
 * Check if database configuration is provided
 */
export function isDatabaseConfigured(): boolean {
  return !!dbConfig
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return pool !== null
}

/**
 * Initialize database connection and create tables if not exist
 * Returns true if database was initialized, false if skipped (no config)
 */
export async function initializeDatabase(): Promise<boolean> {
  // Skip if database is not configured
  if (!isDatabaseConfigured()) {
    consola.info("Database not configured, using memory-only mode")
    return false
  }

  try {
    consola.info(`Connecting to ${sqlConfig.server}/${sqlConfig.database}...`)
    pool = await sql.connect(sqlConfig)
    consola.success("Connected to SQL Server")

    // Check if GithubTokens table exists, if not create it
    // If table exists, use it directly (fields are guaranteed to be correct)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='GithubTokens' AND xtype='U')
      BEGIN
        CREATE TABLE GithubTokens (
          id INT IDENTITY(1,1) PRIMARY KEY,
          Token NVARCHAR(500) NOT NULL,
          UserName NVARCHAR(100) UNIQUE,
          AccountType NVARCHAR(50) DEFAULT 'individual',
          IsActive BIT DEFAULT 1
        )
      END
    `)

    // Drop old unique constraint on Token if exists
    await pool.request().query(`
      BEGIN TRY
        -- Try to drop the old unique constraint on Token
        DECLARE @constraintName NVARCHAR(200)
        SELECT @constraintName = name FROM sys.key_constraints 
        WHERE parent_object_id = OBJECT_ID('GithubTokens') 
        AND type = 'UQ' 
        AND OBJECT_NAME(parent_object_id) = 'GithubTokens'
        AND EXISTS (
          SELECT 1 FROM sys.index_columns ic 
          INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE ic.object_id = OBJECT_ID('GithubTokens') AND c.name = 'Token'
        )
        IF @constraintName IS NOT NULL
          EXEC('ALTER TABLE GithubTokens DROP CONSTRAINT ' + @constraintName)
      END TRY
      BEGIN CATCH
        -- Ignore errors
      END CATCH
    `)

    consola.success("Database tables initialized")
    return true
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
  Id: number
  Token: string
  UserName: string | null
  AccountType: string
  IsActive: boolean
}

/**
 * Get all active tokens from database
 */
export async function getAllTokens(): Promise<TokenRecord[]> {
  const pool = getPool()
  const result = await pool.request().query<TokenRecord>(`
    SELECT * FROM GithubTokens WHERE IsActive = 1
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
    .query<TokenRecord>(`SELECT * FROM GithubTokens WHERE id = @id`)
  return result.recordset[0] || null
}

/**
 * Get a token by GitHub token value
 */
export async function getTokenByGithubToken(githubToken: string): Promise<TokenRecord | null> {
  const pool = getPool()
  const result = await pool.request()
    .input("Token", sql.NVarChar, githubToken)
    .query<TokenRecord>(`SELECT * FROM GithubTokens WHERE Token = @Token`)
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
    .input("Token", sql.NVarChar, githubToken)
    .input("UserName", sql.NVarChar, username || null)
    .input("AccountType", sql.NVarChar, accountType)
    .query(`
      MERGE GithubTokens AS target
      USING (SELECT @UserName AS UserName) AS source
      ON target.UserName = source.UserName
      WHEN MATCHED THEN
        UPDATE SET Token = @Token, AccountType = @AccountType, IsActive = 1
      WHEN NOT MATCHED THEN
        INSERT (Token, UserName, AccountType) VALUES (@Token, @UserName, @AccountType)
      OUTPUT inserted.id;
    `)
  return result.recordset[0]?.id
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
    .input("Token", sql.NVarChar, githubToken)
    .query(`
      UPDATE GithubTokens 
      SET Token = @Token, 
          IsActive = 1
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
    .query(`UPDATE GithubTokens SET IsActive = 0 WHERE id = @id`)
}

/**
 * Delete all tokens (soft delete - sets IsActive = 0 for all records)
 */
export async function deleteAllTokens(): Promise<number> {
  const pool = getPool()
  const result = await pool.request().query(`UPDATE GithubTokens SET IsActive = 0 WHERE IsActive = 1`)
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
