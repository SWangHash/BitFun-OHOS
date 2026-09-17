use crate::error::{SkinMarketError, SkinMarketResult};
use chrono::Utc;
use bitfun_product_domains::appearance_market::AppearanceMarketUserSummary;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Row, Sqlite};
use std::path::Path;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_init.sql");

#[derive(Debug, Clone)]
pub(crate) struct Database {
    pool: Pool<Sqlite>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalUser {
    pub internal_id: i64,
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
        let database = Self { pool };
        database.migrate().await?;
        Ok(database)
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

    pub(crate) async fn upsert_user(
        &self,
        profile: &AppearanceMarketUserSummary,
    ) -> SkinMarketResult<LocalUser> {
        let now = Utc::now().timestamp();
        let account_id = profile
            .identity_id()
            .ok_or_else(|| SkinMarketError::unavailable("Unsupported account identity"))?;
        sqlx::query(
            "INSERT INTO users(account_id, github_id, login, avatar_url, created_at, updated_at)
             VALUES(?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id) DO UPDATE SET
               login = excluded.login,
               avatar_url = excluded.avatar_url,
               updated_at = excluded.updated_at",
        )
        .bind(&account_id)
        .bind((profile.github_id > 0).then_some(profile.github_id))
        .bind(&profile.login)
        .bind(&profile.avatar_url)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(SkinMarketError::internal)?;
        let row =
            sqlx::query("SELECT id, github_id, login, avatar_url FROM users WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&self.pool)
                .await
                .map_err(SkinMarketError::internal)?;
        Ok(LocalUser {
            internal_id: row.get("id"),
        })
    }
}

#[cfg(test)]
mod email_tests {
    use super::*;
    #[tokio::test]
    async fn migration_preserves_legacy_owners_and_separates_email_accounts() {
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
        sqlx::raw_sql("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(1,0); INSERT INTO users VALUES(7,42,'alice','',1,1);").execute(&pool).await.unwrap();
        pool.close().await;
        let github = AppearanceMarketUserSummary {
            account_id: None,
            github_id: 42,
            login: "alice".into(),
            avatar_url: "".into(),
        };
        let email = AppearanceMarketUserSummary {
            account_id: Some("email-42".into()),
            github_id: 0,
            login: "member".into(),
            avatar_url: "".into(),
        };
        for _ in 0..2 {
            let db = Database::open(&path).await.unwrap();
            assert_eq!(db.upsert_user(&github).await.unwrap().internal_id, 7);
            let other = db.upsert_user(&email).await.unwrap();
            assert_ne!(other.internal_id, 7);
            assert_eq!(
                db.upsert_user(&email).await.unwrap().internal_id,
                other.internal_id
            );
            assert!(sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(db.pool())
                .await
                .unwrap()
                .is_empty());
            db.pool.close().await;
        }
    }
}
