//! Opaque, ordered session messages. The protocol follows Happy's v3 message
//! log: stable localId for retry, independent receive seq, and bounded pages.
use crate::db::DbPool;
use anyhow::{anyhow, bail, Result};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::Row;

pub(crate) const MAX_BATCH: usize = 50;
pub(crate) const MAX_CONTENT_BYTES: usize = 128 * 1024;
pub(crate) const MAX_BATCH_BYTES: usize = MAX_BATCH * (MAX_CONTENT_BYTES + 256);

pub(crate) const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS realtime_sessions (
 account_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 machine_id TEXT NOT NULL,
 seq INTEGER NOT NULL DEFAULT 0,
 metadata TEXT NOT NULL,
 metadata_version INTEGER NOT NULL DEFAULT 1,
 agent_state TEXT,
 agent_state_version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(account_id, id)
);
CREATE TABLE IF NOT EXISTS realtime_messages (
 account_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 id TEXT NOT NULL,
 seq INTEGER NOT NULL,
 local_id TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id, session_id, seq),
 UNIQUE(account_id, session_id, local_id),
 FOREIGN KEY(account_id, session_id) REFERENCES realtime_sessions(account_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS realtime_account_sequence (
 account_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
 seq INTEGER NOT NULL DEFAULT 0,
 log_bytes INTEGER NOT NULL DEFAULT 0
);
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NewMessage {
    pub(crate) local_id: String,
    pub(crate) content: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Message {
    pub(crate) id: String,
    pub(crate) seq: i64,
    pub(crate) local_id: String,
    pub(crate) content: EncryptedContent,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct EncryptedContent {
    pub(crate) t: String,
    pub(crate) c: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessagePage {
    pub(crate) messages: Vec<Message>,
    pub(crate) has_more: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Session {
    pub(crate) id: String,
    pub(crate) machine_id: String,
    pub(crate) seq: i64,
    pub(crate) metadata: String,
    pub(crate) metadata_version: i64,
    pub(crate) agent_state: Option<String>,
    pub(crate) agent_state_version: i64,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

pub(crate) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

pub(crate) async fn open_session(
    db: &DbPool,
    account: &str,
    machine: &str,
    id: &str,
    metadata: &str,
) -> Result<Session> {
    if !valid_id(id) || metadata.len() > MAX_CONTENT_BYTES {
        bail!("invalid session");
    }
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT INTO realtime_sessions(account_id,id,machine_id,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,id) DO NOTHING")
        .bind(account).bind(id).bind(machine).bind(metadata).bind(now).bind(now).execute(db).await?;
    let session = get_session(db, account, id)
        .await?
        .ok_or_else(|| anyhow!("session unavailable"))?;
    if session.machine_id != machine {
        bail!("session belongs to another machine");
    }
    Ok(session)
}

pub(crate) async fn get_session(db: &DbPool, account: &str, id: &str) -> Result<Option<Session>> {
    let row = sqlx::query("SELECT * FROM realtime_sessions WHERE account_id=? AND id=?")
        .bind(account)
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| Session {
        id: r.get("id"),
        machine_id: r.get("machine_id"),
        seq: r.get("seq"),
        metadata: r.get("metadata"),
        metadata_version: r.get("metadata_version"),
        agent_state: r.get("agent_state"),
        agent_state_version: r.get("agent_state_version"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }))
}

/// The transaction locks the account counter before reading either dedup keys
/// or session sequence. Concurrent writers cannot allocate the same sequence.
/// Reusing a localId with different content is an error, never silent success.
pub(crate) async fn append(
    db: &DbPool,
    account: &str,
    session: &str,
    messages: &[NewMessage],
) -> Result<Vec<(Message, Option<i64>)>> {
    if messages.is_empty() || messages.len() > MAX_BATCH {
        bail!("invalid message batch size");
    }
    for m in messages {
        if !valid_id(&m.local_id) || m.content.is_empty() || m.content.len() > MAX_CONTENT_BYTES {
            bail!("invalid message");
        }
    }
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO realtime_account_sequence(account_id) VALUES(?) ON CONFLICT(account_id) DO UPDATE SET seq=seq")
        .bind(account).execute(&mut *tx).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM realtime_sessions WHERE account_id=? AND id=?)",
    )
    .bind(account)
    .bind(session)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        bail!("session not found");
    }
    let mut results = Vec::with_capacity(messages.len());
    for m in messages {
        if let Some(row) = sqlx::query(
            "SELECT * FROM realtime_messages WHERE account_id=? AND session_id=? AND local_id=?",
        )
        .bind(account)
        .bind(session)
        .bind(&m.local_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let existing = message_from_row(row);
            if existing.content.c != m.content {
                bail!("localId content conflict");
            }
            results.push((existing, None));
            continue;
        }
        let now = chrono::Utc::now().timestamp_millis();
        // Track storage usage without imposing a lifetime account ceiling.
        // Per-request paging and admission bound memory independently of
        // how long an account has been used.
        let user_seq: i64 = sqlx::query_scalar("UPDATE realtime_account_sequence SET seq=seq+1,log_bytes=log_bytes+? WHERE account_id=? RETURNING seq")
            .bind(m.content.len() as i64).bind(account)
            .fetch_one(&mut *tx).await?;
        let seq: i64 = sqlx::query_scalar("UPDATE realtime_sessions SET seq=seq+1,updated_at=? WHERE account_id=? AND id=? RETURNING seq")
            .bind(now).bind(account).bind(session).fetch_one(&mut *tx).await?;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO realtime_messages(account_id,session_id,id,seq,local_id,content,created_at) VALUES(?,?,?,?,?,?,?)")
            .bind(account).bind(session).bind(&id).bind(seq).bind(&m.local_id).bind(&m.content).bind(now).execute(&mut *tx).await?;
        results.push((
            Message {
                id,
                seq,
                local_id: m.local_id.clone(),
                content: EncryptedContent {
                    t: "encrypted".into(),
                    c: m.content.clone(),
                },
                created_at: now,
                updated_at: now,
            },
            Some(user_seq),
        ));
    }
    tx.commit().await?;
    Ok(results)
}

fn message_from_row(row: sqlx::sqlite::SqliteRow) -> Message {
    Message {
        id: row.get("id"),
        seq: row.get("seq"),
        local_id: row.get("local_id"),
        content: EncryptedContent {
            t: "encrypted".into(),
            c: row.get("content"),
        },
        created_at: row.get("created_at"),
        updated_at: row.get("created_at"),
    }
}

pub(crate) async fn read(
    db: &DbPool,
    account: &str,
    session: &str,
    after: i64,
    before: Option<i64>,
    limit: usize,
) -> Result<MessagePage> {
    if after < 0 || before.is_some_and(|v| v <= 0) || !(1..=100).contains(&limit) {
        bail!("invalid message cursor");
    }
    if before.is_some() && after != 0 {
        bail!("message cursors are mutually exclusive");
    }
    // Stream rows so the page budget also bounds database materialization.
    // Historical pages keep Happy's newest-first ordering; catch-up is ascending.
    let (sql, cursor) = match before {
        Some(cursor) => ("SELECT * FROM realtime_messages WHERE account_id=? AND session_id=? AND seq<? ORDER BY seq DESC LIMIT ?", cursor),
        None => ("SELECT * FROM realtime_messages WHERE account_id=? AND session_id=? AND seq>? ORDER BY seq ASC LIMIT ?", after),
    };
    let mut rows = sqlx::query(sql)
        .bind(account)
        .bind(session)
        .bind(cursor)
        .bind((limit + 1) as i64)
        .fetch(db);
    let mut messages = Vec::new();
    let mut bytes = 0;
    let mut has_more = false;
    while let Some(row) = rows.try_next().await? {
        let message = message_from_row(row);
        let size = serde_json::to_vec(&message)?.len();
        if messages.len() == limit || (!messages.is_empty() && bytes + size > 1024 * 1024) {
            has_more = true;
            break;
        }
        bytes += size;
        messages.push(message);
    }
    Ok(MessagePage { messages, has_more })
}

/// Optimistic version checks use one UPDATE, so concurrent controllers cannot
/// overwrite each other after observing the same version.
pub(crate) async fn update_metadata(
    db: &DbPool,
    account: &str,
    session: &str,
    expected: i64,
    metadata: &str,
) -> Result<serde_json::Value> {
    if expected < 0 || metadata.len() > MAX_CONTENT_BYTES {
        bail!("invalid metadata");
    }
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO realtime_account_sequence(account_id) VALUES(?) ON CONFLICT(account_id) DO UPDATE SET seq=seq")
        .bind(account).execute(&mut *tx).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let version: Option<i64> = sqlx::query_scalar("UPDATE realtime_sessions SET metadata=?,metadata_version=metadata_version+1,updated_at=? WHERE account_id=? AND id=? AND metadata_version=? RETURNING metadata_version")
        .bind(metadata).bind(now).bind(account).bind(session).bind(expected).fetch_optional(&mut *tx).await?;
    if let Some(version) = version {
        let seq: i64 = sqlx::query_scalar(
            "UPDATE realtime_account_sequence SET seq=seq+1 WHERE account_id=? RETURNING seq",
        )
        .bind(account)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(
            serde_json::json!({"result":"success","version":version,"metadata":metadata,
            "update":{"id":uuid::Uuid::new_v4().to_string(),"seq":seq,"createdAt":now,
                "body":{"t":"update-session","id":session,"metadata":{"value":metadata,"version":version}}}}),
        );
    }
    let current = sqlx::query(
        "SELECT metadata,metadata_version FROM realtime_sessions WHERE account_id=? AND id=?",
    )
    .bind(account)
    .bind(session)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow!("session not found"))?;
    let metadata: String = current.get("metadata");
    let version: i64 = current.get("metadata_version");
    tx.commit().await?;
    Ok(serde_json::json!({"result":"version-mismatch","version":version,"metadata":metadata}))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn database() -> DbPool {
        let db = crate::db::connect(":memory:").await.unwrap();
        crate::db::UserRow::create(&db, "a", "a").await.unwrap();
        open_session(&db, "a", "host", "session", "opaque")
            .await
            .unwrap();
        db
    }
    #[tokio::test]
    async fn continued_use_is_not_rejected_at_a_lifetime_storage_threshold() {
        let db = database().await;
        let previous_bytes: i64 = 256 * 1024 * 1024;
        sqlx::query("INSERT INTO realtime_account_sequence(account_id, seq, log_bytes) VALUES('a', 0, ?) ON CONFLICT(account_id) DO UPDATE SET log_bytes=excluded.log_bytes")
            .bind(previous_bytes).execute(&db).await.unwrap();
        let result = append(
            &db,
            "a",
            "session",
            &[NewMessage {
                local_id: "continued".into(),
                content: "ciphertext".into(),
            }],
        )
        .await
        .unwrap();
        assert_eq!(result[0].0.seq, 1);
        let bytes: i64 = sqlx::query_scalar(
            "SELECT log_bytes FROM realtime_account_sequence WHERE account_id='a'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(bytes, previous_bytes + 10);
    }

    #[tokio::test]
    async fn retries_are_idempotent_and_conflicts_roll_back_the_entire_batch() {
        let db = database().await;
        let msg = NewMessage {
            local_id: "one".into(),
            content: "ciphertext".into(),
        };
        let first = append(&db, "a", "session", &[msg.clone()]).await.unwrap();
        let retry = append(&db, "a", "session", &[msg.clone()]).await.unwrap();
        assert_eq!(first[0].0, retry[0].0);
        assert_eq!(retry[0].1, None);
        assert!(append(
            &db,
            "a",
            "session",
            &[
                NewMessage {
                    local_id: "two".into(),
                    content: "two".into()
                },
                NewMessage {
                    content: "conflict".into(),
                    ..msg
                }
            ]
        )
        .await
        .is_err());
        assert_eq!(
            read(&db, "a", "session", 0, None, 100)
                .await
                .unwrap()
                .messages
                .len(),
            1
        );
    }
    #[tokio::test]
    async fn concurrent_writers_order_without_skipping_other_senders() {
        let db = database().await;
        let first = [NewMessage {
            local_id: "a".into(),
            content: "a".into(),
        }];
        let second = [NewMessage {
            local_id: "b".into(),
            content: "b".into(),
        }];
        let (a, b) = tokio::join!(
            append(&db, "a", "session", &first),
            append(&db, "a", "session", &second)
        );
        a.unwrap();
        b.unwrap();
        let page = read(&db, "a", "session", 0, None, 1).await.unwrap();
        assert_eq!(page.messages[0].seq, 1);
        assert!(page.has_more);
        let tail = read(&db, "a", "session", 1, None, 100).await.unwrap();
        assert_eq!(tail.messages[0].seq, 2);
        assert!(read(&db, "other", "session", 0, None, 100)
            .await
            .unwrap()
            .messages
            .is_empty());
    }
    #[tokio::test]
    async fn history_pages_descend_and_catch_up_pages_ascend() {
        let db = database().await;
        let batch: Vec<_> = (1..=5)
            .map(|n| NewMessage {
                local_id: n.to_string(),
                content: n.to_string(),
            })
            .collect();
        append(&db, "a", "session", &batch).await.unwrap();
        let history = read(&db, "a", "session", 0, Some(6), 2).await.unwrap();
        assert_eq!(
            history.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
            [5, 4]
        );
        assert!(history.has_more);
        let older = read(&db, "a", "session", 0, Some(4), 3).await.unwrap();
        assert_eq!(
            older.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
            [3, 2, 1]
        );
        assert!(!older.has_more);
        assert!(read(&db, "a", "session", 1, Some(4), 3).await.is_err());
    }
    #[tokio::test]
    async fn byte_bounded_pages_recover_every_message_without_skips() {
        let db = database().await;
        let batch: Vec<_> = (0..20)
            .map(|n| NewMessage {
                local_id: n.to_string(),
                content: "x".repeat(MAX_CONTENT_BYTES),
            })
            .collect();
        append(&db, "a", "session", &batch).await.unwrap();
        let mut cursor = 0;
        let mut pages = 0;
        loop {
            let page = read(&db, "a", "session", cursor, None, 100).await.unwrap();
            assert!(serde_json::to_vec(&page.messages).unwrap().len() < 1024 * 1024);
            for message in page.messages {
                assert_eq!(message.seq, cursor + 1);
                cursor = message.seq;
            }
            pages += 1;
            if !page.has_more {
                break;
            }
        }
        assert_eq!(cursor, 20);
        assert!(pages > 1);
    }
    #[tokio::test]
    async fn metadata_and_messages_share_account_sequence_but_not_receive_cursor() {
        let db = database().await;
        let update = update_metadata(&db, "a", "session", 1, "new")
            .await
            .unwrap();
        assert_eq!(update["update"]["seq"], 1);
        assert!(update["update"]["id"].as_str().is_some());
        let message = append(
            &db,
            "a",
            "session",
            &[NewMessage {
                local_id: "one".into(),
                content: "one".into(),
            }],
        )
        .await
        .unwrap();
        assert_eq!(message[0].1, Some(2));
        assert_eq!(message[0].0.seq, 1);
        update_metadata(&db, "a", "session", 1, "stale")
            .await
            .unwrap();
        let sequence: i64 =
            sqlx::query_scalar("SELECT seq FROM realtime_account_sequence WHERE account_id='a'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(sequence, 2);
    }
    #[tokio::test]
    async fn metadata_compare_and_swap_returns_current_version_on_conflict() {
        let db = database().await;
        assert_eq!(
            update_metadata(&db, "a", "session", 1, "new")
                .await
                .unwrap()["result"],
            "success"
        );
        let conflict = update_metadata(&db, "a", "session", 1, "stale")
            .await
            .unwrap();
        assert_eq!(conflict["result"], "version-mismatch");
        assert_eq!(conflict["metadata"], "new");
        assert_eq!(conflict["version"], 2);
    }
}
