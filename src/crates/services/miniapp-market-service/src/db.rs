use crate::error::{MarketError, MarketResult};
use chrono::Utc;
use openbitfun_product_domains::miniapp::market::MarketUserSummary;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Row, Sqlite};
use std::path::Path;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_init.sql");

#[derive(Debug, Clone)]
pub(crate) struct Database {
    pool: Pool<Sqlite>,
}

#[derive(Debug, Clone)]
pub(crate) struct AuthenticatedUser {
    pub internal_id: i64,
    pub profile: MarketUserSummary,
    pub email: Option<String>,
}

impl Database {
    pub(crate) async fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;
        let db = Self { pool };
        db.migrate().await?;
        db.cleanup_expired_auth().await?;
        Ok(db)
    }

    pub(crate) fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;
        let applied: Option<(i64,)> =
            sqlx::query_as("SELECT version FROM schema_migrations WHERE version = 1")
                .fetch_optional(&self.pool)
                .await?;
        if applied.is_none() {
            let mut transaction = self.pool.begin().await?;
            sqlx::raw_sql(INITIAL_MIGRATION)
                .execute(&mut *transaction)
                .await?;
            sqlx::query("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)")
                .bind(Utc::now().timestamp())
                .execute(&mut *transaction)
                .await?;
            transaction.commit().await?;
        }
        let applied: Option<(i64,)> =
            sqlx::query_as("SELECT version FROM schema_migrations WHERE version = 2")
                .fetch_optional(&self.pool)
                .await?;
        if applied.is_none() {
            use sqlx::Acquire;
            let mut connection = self.pool.acquire().await?;
            // This connection must never return to the pool with FK checks disabled.
            connection.close_on_drop();
            sqlx::query("PRAGMA foreign_keys = OFF")
                .execute(&mut *connection)
                .await?;
            let mut transaction = connection.begin().await?;
            sqlx::raw_sql(include_str!("../migrations/0002_email_identity.sql"))
                .execute(&mut *transaction)
                .await?;
            let violations = sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&mut *transaction)
                .await?;
            anyhow::ensure!(
                violations.is_empty(),
                "Identity migration violated foreign keys"
            );
            sqlx::query("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)")
                .bind(Utc::now().timestamp())
                .execute(&mut *transaction)
                .await?;
            transaction.commit().await?;
        }
        Ok(())
    }

    pub(crate) async fn cleanup_expired_auth(&self) -> anyhow::Result<()> {
        let now = Utc::now().timestamp();
        sqlx::query("DELETE FROM email_browser_grants WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        // Keep one day of send history to enforce persistent address/global quotas.
        sqlx::query("DELETE FROM email_challenges WHERE created_at <= ?")
            .bind(now - 86400)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM login_flows WHERE expires_at <= ? AND NOT EXISTS (SELECT 1 FROM email_challenges c WHERE c.ticket_hash = login_flows.ticket_hash)").bind(now - 86400).execute(&self.pool).await?;
        sqlx::query("DELETE FROM web_sessions WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM oauth_flows WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "UPDATE desktop_auth_transactions
             SET status = 'expired', updated_at = ?
             WHERE expires_at <= ? AND status IN ('pending', 'authorized')",
        )
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        // Keep a bounded grace period for clients polling an expired sign-in.
        // These are transient authorization transactions, never product records.
        sqlx::query("DELETE FROM desktop_auth_transactions WHERE expires_at <= ? AND NOT EXISTS (SELECT 1 FROM login_flows f WHERE f.transaction_id = desktop_auth_transactions.id)")
            .bind(now - 3600)
            .execute(&self.pool)
            .await?;
        // Retain unexpired revoked refresh tokens for replay-family revocation.
        sqlx::query("DELETE FROM api_tokens WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub(crate) async fn upsert_github_user(
        &self,
        github_id: i64,
        login: &str,
        avatar_url: &str,
    ) -> MarketResult<AuthenticatedUser> {
        let now = Utc::now().timestamp();
        sqlx::query(
            "INSERT INTO users(github_id, login, avatar_url, created_at, updated_at)
             VALUES(?, ?, ?, ?, ?)
             ON CONFLICT(github_id) DO UPDATE
             SET login = excluded.login, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at",
        )
        .bind(github_id)
        .bind(login)
        .bind(avatar_url)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        self.user_by_github_id(github_id)
            .await?
            .ok_or_else(|| MarketError::internal("GitHub user disappeared after upsert"))
    }

    pub(crate) async fn user_by_github_id(
        &self,
        github_id: i64,
    ) -> MarketResult<Option<AuthenticatedUser>> {
        let row = sqlx::query(
            "SELECT id, github_id, login, avatar_url, NULL AS email FROM users WHERE github_id = ?",
        )
        .bind(github_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(row.map(user_from_row))
    }

    pub(crate) async fn create_web_session(
        &self,
        user_id: i64,
        token: &str,
        csrf_token: &str,
        expires_at: i64,
    ) -> MarketResult<()> {
        sqlx::query(
            "INSERT INTO web_sessions(token_hash, user_id, csrf_hash, expires_at, created_at)
             VALUES(?, ?, ?, ?, ?)",
        )
        .bind(token_hash(token))
        .bind(user_id)
        .bind(token_hash(csrf_token))
        .bind(expires_at)
        .bind(Utc::now().timestamp())
        .execute(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(())
    }

    pub(crate) async fn web_session_user(
        &self,
        token: &str,
    ) -> MarketResult<Option<(AuthenticatedUser, String, i64)>> {
        let row = sqlx::query(
            "SELECT u.id, u.github_id, u.login, u.avatar_url, e.email, s.csrf_hash, s.expires_at
             FROM web_sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN email_identities e ON e.user_id = u.id AND u.github_id IS NULL
             WHERE s.token_hash = ? AND s.expires_at > ?",
        )
        .bind(token_hash(token))
        .bind(Utc::now().timestamp())
        .fetch_optional(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(row.map(|row| {
            let csrf_hash = row.get::<String, _>("csrf_hash");
            let expires_at = row.get::<i64, _>("expires_at");
            (user_from_row(row), csrf_hash, expires_at)
        }))
    }

    pub(crate) async fn delete_web_session(&self, token: &str) -> MarketResult<()> {
        sqlx::query("DELETE FROM web_sessions WHERE token_hash = ?")
            .bind(token_hash(token))
            .execute(&self.pool)
            .await
            .map_err(MarketError::internal)?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn create_api_token(
        &self,
        user_id: i64,
        token: &str,
        token_type: &str,
        family_id: &str,
        expires_at: i64,
    ) -> MarketResult<()> {
        sqlx::query(
            "INSERT INTO api_tokens(token_hash, user_id, token_type, family_id, expires_at, created_at)
             VALUES(?, ?, ?, ?, ?, ?)",
        )
        .bind(token_hash(token))
        .bind(user_id)
        .bind(token_type)
        .bind(family_id)
        .bind(expires_at)
        .bind(Utc::now().timestamp())
        .execute(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(())
    }

    pub(crate) async fn api_token_user(
        &self,
        token: &str,
        token_type: &str,
    ) -> MarketResult<Option<(AuthenticatedUser, String)>> {
        let row = sqlx::query(
            "SELECT u.id, u.github_id, u.login, u.avatar_url, e.email, t.family_id
             FROM api_tokens t
             JOIN users u ON u.id = t.user_id
             LEFT JOIN email_identities e ON e.user_id = u.id AND u.github_id IS NULL
             WHERE t.token_hash = ? AND t.token_type = ? AND t.expires_at > ?
               AND t.revoked_at IS NULL",
        )
        .bind(token_hash(token))
        .bind(token_type)
        .bind(Utc::now().timestamp())
        .fetch_optional(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(row.map(|row| {
            let family_id = row.get::<String, _>("family_id");
            (user_from_row(row), family_id)
        }))
    }

    pub(crate) async fn revoke_token_family(&self, family_id: &str) -> MarketResult<()> {
        sqlx::query(
            "UPDATE api_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
        )
        .bind(Utc::now().timestamp())
        .bind(family_id)
        .execute(&self.pool)
        .await
        .map_err(MarketError::internal)?;
        Ok(())
    }
}

fn user_from_row(row: sqlx::sqlite::SqliteRow) -> AuthenticatedUser {
    AuthenticatedUser {
        internal_id: row.get("id"),
        email: row.get("email"),
        profile: MarketUserSummary {
            account_id: Some(match row.get::<Option<i64>, _>("github_id") {
                Some(id) => id.to_string(),
                None => format!("email-{}", row.get::<i64, _>("id")),
            }),
            github_id: row.get::<Option<i64>, _>("github_id").unwrap_or_default(),
            // Existing relay versions validate this protocol handle as a GitHub-style
            // username. The verified email is carried separately for display.
            login: row.get("login"),
            avatar_url: row.get("avatar_url"),
        },
    }
}

pub(crate) fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[cfg(test)]
mod email_migration_tests {
    use super::*;
    #[tokio::test]
    async fn legacy_database_preserves_users_sessions_and_foreign_keys_on_repeated_startup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(INITIAL_MIGRATION)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(1, 0); INSERT INTO users VALUES(7, 42, 'legacy-user', '', 1, 1);").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO web_sessions VALUES(?, 7, ?, ?, 1)")
            .bind(token_hash("legacy-session"))
            .bind(token_hash("csrf"))
            .bind(Utc::now().timestamp() + 600)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        for _ in 0..2 {
            let db = Database::open(&path).await.unwrap();
            let (user, _, _) = db
                .web_session_user("legacy-session")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(user.internal_id, 7);
            assert_eq!(user.profile.identity_id().as_deref(), Some("42"));
            assert!(sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(db.pool())
                .await
                .unwrap()
                .is_empty());
            assert!(db
                .create_web_session(999, "invalid", "csrf", Utc::now().timestamp() + 600)
                .await
                .is_err());
            assert_eq!(
                db.upsert_github_user(42, "legacy-user", "")
                    .await
                    .unwrap()
                    .internal_id,
                7
            );
            db.pool.close().await;
        }
    }
}
