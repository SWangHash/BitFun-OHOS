//! SQLite persistence for knowledge bases, items, and the derived retrieval
//! index.
//!
//! A single database at `U/data/knowledge/knowledge.sqlite` holds the business
//! rows (`knowledge_base`, `knowledge_item`) and the rebuildable retrieval
//! projection (`knowledge_material`, `knowledge_unit`, `knowledge_fts`,
//! `knowledge_embedding`), all scoped by `base_id`. This mirrors Cherry Studio's
//! two-store split (authoritative SQLite + derived index) in one file for the
//! first vertical slice; splitting the index per base later is a storage detail
//! behind this module.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::util::errors::{BitFunError, BitFunResult};

use super::types::{
    KnowledgeBase, KnowledgeBaseStatus, KnowledgeItem, KnowledgeItemStatus, KnowledgeItemType,
};

/// A raw retrieval hit from the index projection.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeSearchHit {
    pub item_id: String,
    pub unit_id: String,
    pub text: String,
    pub unit_index: i64,
    pub score: f64,
}

/// A stored unit of a material.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeStoredUnit {
    pub unit_id: String,
    pub unit_index: i64,
    pub text: String,
}

/// A unit to write into the retrieval projection.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeUnitInput {
    pub unit_id: String,
    pub unit_index: i64,
    pub char_start: i64,
    pub char_end: i64,
    pub text: String,
    pub embedding_text_hash: Option<String>,
}

pub(crate) struct KnowledgeStore {
    connection: Connection,
}

impl KnowledgeStore {
    pub(crate) fn open(path: &Path) -> BitFunResult<Self> {
        let connection = Connection::open(path).map_err(|error| {
            BitFunError::service(format!("Failed to open knowledge db: {error}"))
        })?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| BitFunError::service(format!("Failed to set WAL mode: {error}")))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| {
                BitFunError::service(format!("Failed to enable foreign keys: {error}"))
            })?;
        let store = Self { connection };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> BitFunResult<()> {
        self.connection
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS knowledge_base (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    embedding_model_id TEXT,
                    dimensions INTEGER,
                    rerank_model_id TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    chunk_size INTEGER NOT NULL,
                    chunk_overlap INTEGER NOT NULL,
                    chunk_strategy TEXT NOT NULL,
                    chunk_separator TEXT NOT NULL,
                    threshold REAL,
                    document_count INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_item (
                    id TEXT PRIMARY KEY,
                    base_id TEXT NOT NULL,
                    group_id TEXT,
                    type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS knowledge_item_base_idx
                    ON knowledge_item(base_id, type, created_at);

                CREATE TABLE IF NOT EXISTS knowledge_material (
                    material_id TEXT PRIMARY KEY,
                    base_id TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    content_hash TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_unit (
                    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    unit_id TEXT NOT NULL,
                    material_id TEXT NOT NULL,
                    base_id TEXT NOT NULL,
                    unit_index INTEGER NOT NULL,
                    char_start INTEGER NOT NULL,
                    char_end INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    embedding_text_hash TEXT
                );
                CREATE INDEX IF NOT EXISTS knowledge_unit_material_idx
                    ON knowledge_unit(material_id);
                CREATE INDEX IF NOT EXISTS knowledge_unit_embedding_hash_idx
                    ON knowledge_unit(embedding_text_hash);

                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
                    USING fts5(unit_id UNINDEXED, text, tokenize='trigram');

                CREATE TABLE IF NOT EXISTS knowledge_embedding (
                    embedding_text_hash TEXT PRIMARY KEY,
                    vector_blob BLOB NOT NULL
                );

                CREATE TABLE IF NOT EXISTS knowledge_job (
                    id TEXT PRIMARY KEY,
                    base_id TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS knowledge_job_status_idx
                    ON knowledge_job(status, created_at);
                "#,
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to init knowledge schema: {error}"))
            })?;
        // Best-effort forward migration for databases created before embeddings
        // existed; a duplicate-column error means it is already present.
        let _ = self.connection.execute(
            "ALTER TABLE knowledge_unit ADD COLUMN embedding_text_hash TEXT",
            [],
        );
        let _ = self.connection.execute(
            "ALTER TABLE knowledge_base ADD COLUMN rerank_model_id TEXT",
            [],
        );
        Ok(())
    }

    // ---- Bases -----------------------------------------------------------

    pub(crate) fn insert_base(&self, base: &KnowledgeBase) -> BitFunResult<()> {
        self.connection
            .execute(
                r#"INSERT INTO knowledge_base
                   (id, name, embedding_model_id, dimensions, rerank_model_id, status, error,
                    chunk_size, chunk_overlap, chunk_strategy, chunk_separator,
                    threshold, document_count, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"#,
                params![
                    base.id,
                    base.name,
                    base.embedding_model_id,
                    base.dimensions,
                    base.rerank_model_id,
                    base.status.as_str(),
                    base.error,
                    base.chunk_size,
                    base.chunk_overlap,
                    base.chunk_strategy,
                    base.chunk_separator,
                    base.threshold,
                    base.document_count,
                    base.created_at,
                    base.updated_at,
                ],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to insert knowledge base: {error}"))
            })?;
        Ok(())
    }

    pub(crate) fn get_base(&self, base_id: &str) -> BitFunResult<Option<KnowledgeBase>> {
        self.connection
            .query_row(
                r#"SELECT id, name, embedding_model_id, dimensions, rerank_model_id, status, error,
                          chunk_size, chunk_overlap, chunk_strategy, chunk_separator,
                          threshold, document_count, created_at, updated_at
                   FROM knowledge_base WHERE id = ?1"#,
                params![base_id],
                map_base,
            )
            .optional()
            .map_err(|error| {
                BitFunError::service(format!("Failed to load knowledge base: {error}"))
            })
    }

    pub(crate) fn list_bases(&self) -> BitFunResult<Vec<KnowledgeBase>> {
        let mut statement = self
            .connection
            .prepare(
                r#"SELECT id, name, embedding_model_id, dimensions, rerank_model_id, status, error,
                          chunk_size, chunk_overlap, chunk_strategy, chunk_separator,
                          threshold, document_count, created_at, updated_at
                   FROM knowledge_base ORDER BY created_at ASC"#,
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to list knowledge bases: {error}"))
            })?;
        let rows = statement.query_map([], map_base).map_err(|error| {
            BitFunError::service(format!("Failed to list knowledge bases: {error}"))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            BitFunError::service(format!("Failed to read knowledge base row: {error}"))
        })
    }

    pub(crate) fn delete_base(&self, base_id: &str) -> BitFunResult<()> {
        self.connection
            .execute("DELETE FROM knowledge_fts WHERE unit_id IN (SELECT unit_id FROM knowledge_unit WHERE base_id = ?1)", params![base_id])
            .map_err(|error| BitFunError::service(format!("Failed to delete base fts rows: {error}")))?;
        self.connection
            .execute(
                "DELETE FROM knowledge_unit WHERE base_id = ?1",
                params![base_id],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete base units: {error}"))
            })?;
        self.connection
            .execute(
                "DELETE FROM knowledge_material WHERE base_id = ?1",
                params![base_id],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete base materials: {error}"))
            })?;
        self.connection
            .execute(
                "DELETE FROM knowledge_item WHERE base_id = ?1",
                params![base_id],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete base items: {error}"))
            })?;
        self.connection
            .execute("DELETE FROM knowledge_base WHERE id = ?1", params![base_id])
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete knowledge base: {error}"))
            })?;
        Ok(())
    }

    // ---- Items -----------------------------------------------------------

    pub(crate) fn insert_item(&self, item: &KnowledgeItem) -> BitFunResult<()> {
        let data = serde_json::to_string(&item.data)?;
        self.connection
            .execute(
                r#"INSERT INTO knowledge_item
                   (id, base_id, group_id, type, data, status, error, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
                params![
                    item.id,
                    item.base_id,
                    item.group_id,
                    item.item_type.as_str(),
                    data,
                    item.status.as_str(),
                    item.error,
                    item.created_at,
                    item.updated_at,
                ],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to insert knowledge item: {error}"))
            })?;
        Ok(())
    }

    pub(crate) fn get_item(&self, item_id: &str) -> BitFunResult<Option<KnowledgeItem>> {
        self.connection
            .query_row(
                r#"SELECT id, base_id, group_id, type, data, status, error, created_at, updated_at
                   FROM knowledge_item WHERE id = ?1"#,
                params![item_id],
                map_item,
            )
            .optional()
            .map_err(|error| {
                BitFunError::service(format!("Failed to load knowledge item: {error}"))
            })
    }

    pub(crate) fn list_items(&self, base_id: &str) -> BitFunResult<Vec<KnowledgeItem>> {
        let mut statement = self
            .connection
            .prepare(
                r#"SELECT id, base_id, group_id, type, data, status, error, created_at, updated_at
                   FROM knowledge_item WHERE base_id = ?1 ORDER BY created_at ASC"#,
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to list knowledge items: {error}"))
            })?;
        let rows = statement
            .query_map(params![base_id], map_item)
            .map_err(|error| {
                BitFunError::service(format!("Failed to list knowledge items: {error}"))
            })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            BitFunError::service(format!("Failed to read knowledge item row: {error}"))
        })
    }

    pub(crate) fn update_item_status(
        &self,
        item_id: &str,
        status: KnowledgeItemStatus,
        error: Option<&str>,
        updated_at: &str,
    ) -> BitFunResult<()> {
        self.connection
            .execute(
                "UPDATE knowledge_item SET status = ?2, error = ?3, updated_at = ?4 WHERE id = ?1",
                params![item_id, status.as_str(), error, updated_at],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to update knowledge item: {error}"))
            })?;
        Ok(())
    }

    pub(crate) fn update_item_data(
        &self,
        item_id: &str,
        data: &Value,
        updated_at: &str,
    ) -> BitFunResult<()> {
        let data = serde_json::to_string(data)?;
        self.connection
            .execute(
                "UPDATE knowledge_item SET data = ?2, updated_at = ?3 WHERE id = ?1",
                params![item_id, data, updated_at],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to update knowledge item data: {error}"))
            })?;
        Ok(())
    }

    pub(crate) fn delete_item(&self, item_id: &str) -> BitFunResult<()> {
        self.delete_material(item_id)?;
        self.connection
            .execute("DELETE FROM knowledge_item WHERE id = ?1", params![item_id])
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete knowledge item: {error}"))
            })?;
        Ok(())
    }

    // ---- Retrieval projection -------------------------------------------

    pub(crate) fn replace_material(
        &self,
        material_id: &str,
        base_id: &str,
        relative_path: &str,
        content_hash: &str,
        units: &[KnowledgeUnitInput],
        embeddings: &[(String, Vec<u8>)],
        updated_at: &str,
    ) -> BitFunResult<()> {
        self.delete_material(material_id)?;
        self.connection
            .execute(
                r#"INSERT INTO knowledge_material (material_id, base_id, relative_path, content_hash, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5)"#,
                params![material_id, base_id, relative_path, content_hash, updated_at],
            )
            .map_err(|error| BitFunError::service(format!("Failed to insert knowledge material: {error}")))?;

        for unit in units {
            self.connection
                .execute(
                    r#"INSERT INTO knowledge_unit
                       (unit_id, material_id, base_id, unit_index, char_start, char_end, text, embedding_text_hash)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
                    params![
                        unit.unit_id,
                        material_id,
                        base_id,
                        unit.unit_index,
                        unit.char_start,
                        unit.char_end,
                        unit.text,
                        unit.embedding_text_hash
                    ],
                )
                .map_err(|error| {
                    BitFunError::service(format!("Failed to insert knowledge unit: {error}"))
                })?;
            self.connection
                .execute(
                    "INSERT INTO knowledge_fts (unit_id, text) VALUES (?1, ?2)",
                    params![unit.unit_id, unit.text],
                )
                .map_err(|error| {
                    BitFunError::service(format!("Failed to insert fts row: {error}"))
                })?;
        }

        for (embedding_text_hash, blob) in embeddings {
            self.connection
                .execute(
                    "INSERT OR IGNORE INTO knowledge_embedding (embedding_text_hash, vector_blob) VALUES (?1, ?2)",
                    params![embedding_text_hash, blob],
                )
                .map_err(|error| {
                    BitFunError::service(format!("Failed to insert embedding: {error}"))
                })?;
        }
        Ok(())
    }

    /// Which of the given embedding-text hashes already have a stored vector.
    pub(crate) fn list_existing_embedding_hashes(
        &self,
        hashes: &[String],
    ) -> BitFunResult<std::collections::HashSet<String>> {
        if hashes.is_empty() {
            return Ok(std::collections::HashSet::new());
        }
        let placeholders = vec!["?"; hashes.len()].join(",");
        let sql = format!(
            "SELECT embedding_text_hash FROM knowledge_embedding WHERE embedding_text_hash IN ({placeholders})"
        );
        let mut statement = self.connection.prepare(&sql).map_err(|error| {
            BitFunError::service(format!("Failed to prepare embedding hash lookup: {error}"))
        })?;
        let values: Vec<rusqlite::types::Value> = hashes
            .iter()
            .map(|hash| rusqlite::types::Value::Text(hash.clone()))
            .collect();
        let rows = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| {
                BitFunError::service(format!("Failed to read embedding hashes: {error}"))
            })?;
        let mut existing = std::collections::HashSet::new();
        for row in rows {
            existing.insert(row.map_err(|error| {
                BitFunError::service(format!("Failed to read embedding hash row: {error}"))
            })?);
        }
        Ok(existing)
    }

    /// Brute-force cosine scan over every stored vector in the base. `score` is
    /// the cosine similarity (higher is better).
    pub(crate) fn search_vectors(
        &self,
        base_id: &str,
        query_vector: &[f32],
        top_k: i64,
    ) -> BitFunResult<Vec<KnowledgeSearchHit>> {
        let mut statement = self
            .connection
            .prepare(
                r#"SELECT u.unit_id, u.material_id, u.unit_index, u.text, e.vector_blob
                   FROM knowledge_unit u
                   JOIN knowledge_embedding e ON e.embedding_text_hash = u.embedding_text_hash
                   WHERE u.base_id = ?1 AND u.embedding_text_hash IS NOT NULL"#,
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to prepare vector search: {error}"))
            })?;
        let rows = statement
            .query_map(params![base_id], |row| {
                let blob: Vec<u8> = row.get(4)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    blob,
                ))
            })
            .map_err(|error| {
                BitFunError::service(format!("Failed to run vector search: {error}"))
            })?;

        let mut hits = Vec::new();
        for row in rows {
            let (unit_id, material_id, unit_index, text, blob) = row.map_err(|error| {
                BitFunError::service(format!("Failed to read vector row: {error}"))
            })?;
            let vector = super::vector::decode_vector(&blob);
            let score = super::vector::cosine_similarity(query_vector, &vector);
            hits.push(KnowledgeSearchHit {
                item_id: material_id,
                unit_id,
                text,
                unit_index,
                score: score as f64,
            });
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        hits.truncate(top_k.max(0) as usize);
        Ok(hits)
    }

    pub(crate) fn delete_material(&self, material_id: &str) -> BitFunResult<()> {
        self.connection
            .execute(
                "DELETE FROM knowledge_fts WHERE unit_id IN (SELECT unit_id FROM knowledge_unit WHERE material_id = ?1)",
                params![material_id],
            )
            .map_err(|error| BitFunError::service(format!("Failed to delete material fts rows: {error}")))?;
        self.connection
            .execute(
                "DELETE FROM knowledge_unit WHERE material_id = ?1",
                params![material_id],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete material units: {error}"))
            })?;
        self.connection
            .execute(
                "DELETE FROM knowledge_material WHERE material_id = ?1",
                params![material_id],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to delete knowledge material: {error}"))
            })?;
        Ok(())
    }

    pub(crate) fn list_units(&self, material_id: &str) -> BitFunResult<Vec<KnowledgeStoredUnit>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT unit_id, unit_index, text FROM knowledge_unit WHERE material_id = ?1 ORDER BY unit_index ASC",
            )
            .map_err(|error| BitFunError::service(format!("Failed to list material units: {error}")))?;
        let rows = statement
            .query_map(params![material_id], |row| {
                Ok(KnowledgeStoredUnit {
                    unit_id: row.get(0)?,
                    unit_index: row.get(1)?,
                    text: row.get(2)?,
                })
            })
            .map_err(|error| {
                BitFunError::service(format!("Failed to list material units: {error}"))
            })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| BitFunError::service(format!("Failed to read unit row: {error}")))
    }

    /// BM25 over the trigram FTS index. `score` is returned higher-is-better.
    pub(crate) fn search_bm25(
        &self,
        base_id: &str,
        match_query: &str,
        top_k: i64,
    ) -> BitFunResult<Vec<KnowledgeSearchHit>> {
        let mut statement = self
            .connection
            .prepare(
                r#"SELECT u.unit_id, u.material_id, u.unit_index, u.text, bm25(knowledge_fts) AS score
                   FROM knowledge_fts
                   JOIN knowledge_unit u ON u.unit_id = knowledge_fts.unit_id
                   WHERE knowledge_fts MATCH ?1 AND u.base_id = ?2
                   ORDER BY score ASC
                   LIMIT ?3"#,
            )
            .map_err(|error| BitFunError::service(format!("Failed to prepare bm25 search: {error}")))?;
        let rows = statement
            .query_map(params![match_query, base_id, top_k], |row| {
                let raw_score: f64 = row.get(4)?;
                Ok(KnowledgeSearchHit {
                    item_id: row.get(1)?,
                    unit_id: row.get(0)?,
                    text: row.get(3)?,
                    unit_index: row.get(2)?,
                    score: -raw_score,
                })
            })
            .map_err(|error| BitFunError::service(format!("Failed to run bm25 search: {error}")))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| BitFunError::service(format!("Failed to read search row: {error}")))
    }

    /// LIKE substring fallback for queries whose terms produce no trigram.
    pub(crate) fn search_like(
        &self,
        base_id: &str,
        patterns: &[String],
        top_k: i64,
    ) -> BitFunResult<Vec<KnowledgeSearchHit>> {
        if patterns.is_empty() {
            return Ok(Vec::new());
        }
        let clauses = patterns
            .iter()
            .map(|_| "u.text LIKE ? ESCAPE '\\'")
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!(
            "SELECT u.unit_id, u.material_id, u.unit_index, u.text FROM knowledge_unit u \
             WHERE u.base_id = ? AND {clauses} ORDER BY u.unit_index ASC LIMIT ?"
        );
        let mut statement = self.connection.prepare(&sql).map_err(|error| {
            BitFunError::service(format!("Failed to prepare like search: {error}"))
        })?;

        let mut values: Vec<rusqlite::types::Value> = Vec::with_capacity(patterns.len() + 2);
        values.push(rusqlite::types::Value::Text(base_id.to_string()));
        for pattern in patterns {
            values.push(rusqlite::types::Value::Text(pattern.clone()));
        }
        values.push(rusqlite::types::Value::Integer(top_k));

        let rows = statement
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                Ok(KnowledgeSearchHit {
                    item_id: row.get(1)?,
                    unit_id: row.get(0)?,
                    text: row.get(3)?,
                    unit_index: row.get(2)?,
                    score: 1.0,
                })
            })
            .map_err(|error| BitFunError::service(format!("Failed to run like search: {error}")))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            BitFunError::service(format!("Failed to read like search row: {error}"))
        })
    }

    // ---- Durable jobs ---------------------------------------------------

    pub(crate) fn enqueue_job(
        &self,
        job_id: &str,
        base_id: &str,
        item_id: &str,
        kind: &str,
        now: &str,
    ) -> BitFunResult<()> {
        self.connection
            .execute(
                r#"INSERT INTO knowledge_job
                   (id, base_id, item_id, kind, status, attempts, error, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, 'pending', 0, NULL, ?5, ?5)"#,
                params![job_id, base_id, item_id, kind, now],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to enqueue knowledge job: {error}"))
            })?;
        Ok(())
    }

    /// Claim the oldest pending job, marking it `running`. Single-worker model, so
    /// a plain select-then-update inside one transaction is race-free.
    pub(crate) fn claim_next_job(&self, now: &str) -> BitFunResult<Option<KnowledgeJobRow>> {
        let transaction = self.connection.unchecked_transaction().map_err(|error| {
            BitFunError::service(format!("Failed to start job transaction: {error}"))
        })?;
        let row = transaction
            .query_row(
                "SELECT id, base_id, item_id, kind, attempts FROM knowledge_job WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| {
                    Ok(KnowledgeJobRow {
                        id: row.get(0)?,
                        base_id: row.get(1)?,
                        item_id: row.get(2)?,
                        kind: row.get(3)?,
                        attempts: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| BitFunError::service(format!("Failed to claim knowledge job: {error}")))?;
        if let Some(job) = &row {
            transaction
                .execute(
                    "UPDATE knowledge_job SET status = 'running', attempts = attempts + 1, updated_at = ?2 WHERE id = ?1",
                    params![job.id, now],
                )
                .map_err(|error| {
                    BitFunError::service(format!("Failed to mark knowledge job running: {error}"))
                })?;
        }
        transaction.commit().map_err(|error| {
            BitFunError::service(format!("Failed to commit job claim: {error}"))
        })?;
        Ok(row)
    }

    pub(crate) fn complete_job(&self, job_id: &str, now: &str) -> BitFunResult<()> {
        self.connection
            .execute(
                "UPDATE knowledge_job SET status = 'completed', error = NULL, updated_at = ?2 WHERE id = ?1",
                params![job_id, now],
            )
            .map_err(|error| BitFunError::service(format!("Failed to complete knowledge job: {error}")))?;
        Ok(())
    }

    pub(crate) fn fail_job(&self, job_id: &str, error: &str, now: &str) -> BitFunResult<()> {
        self.connection
            .execute(
                "UPDATE knowledge_job SET status = 'failed', error = ?2, updated_at = ?3 WHERE id = ?1",
                params![job_id, error, now],
            )
            .map_err(|error| BitFunError::service(format!("Failed to fail knowledge job: {error}")))?;
        Ok(())
    }

    /// Startup recovery: a `running` job cannot survive a process restart, so
    /// return it to `pending` for the worker to re-run.
    pub(crate) fn reset_running_jobs(&self, now: &str) -> BitFunResult<()> {
        self.connection
            .execute(
                "UPDATE knowledge_job SET status = 'pending', updated_at = ?1 WHERE status = 'running'",
                params![now],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to reset running knowledge jobs: {error}"))
            })?;
        Ok(())
    }

    /// Park items left active without a pending/running job as `failed`.
    pub(crate) fn fail_orphan_active_items(&self, error: &str, now: &str) -> BitFunResult<()> {
        self.connection
            .execute(
                r#"UPDATE knowledge_item
                   SET status = 'failed', error = ?1, updated_at = ?2
                   WHERE status IN ('preparing', 'processing', 'reading', 'embedding')
                     AND id NOT IN (SELECT item_id FROM knowledge_job WHERE status IN ('pending', 'running'))"#,
                params![error, now],
            )
            .map_err(|error| {
                BitFunError::service(format!("Failed to park orphan knowledge items: {error}"))
            })?;
        Ok(())
    }

    /// Cancel pending/running jobs for a base and its subtree items.
    pub(crate) fn delete_jobs_for_items(&self, item_ids: &[String]) -> BitFunResult<()> {
        for item_id in item_ids {
            self.connection
                .execute(
                    "DELETE FROM knowledge_job WHERE item_id = ?1 AND status IN ('pending', 'running')",
                    params![item_id],
                )
                .map_err(|error| {
                    BitFunError::service(format!("Failed to cancel knowledge jobs: {error}"))
                })?;
        }
        Ok(())
    }
}

/// A claimed durable job.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeJobRow {
    pub id: String,
    pub base_id: String,
    pub item_id: String,
    /// `index` or `expand`; reserved for kind-specific worker behavior.
    #[allow(dead_code)]
    pub kind: String,
    /// Attempt count; reserved for a future bounded-retry policy.
    #[allow(dead_code)]
    pub attempts: i64,
}

fn map_base(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeBase> {
    let status: String = row.get(5)?;
    Ok(KnowledgeBase {
        id: row.get(0)?,
        name: row.get(1)?,
        embedding_model_id: row.get(2)?,
        dimensions: row.get(3)?,
        rerank_model_id: row.get(4)?,
        status: KnowledgeBaseStatus::parse(&status).unwrap_or(KnowledgeBaseStatus::Failed),
        error: row.get(6)?,
        chunk_size: row.get(7)?,
        chunk_overlap: row.get(8)?,
        chunk_strategy: row.get(9)?,
        chunk_separator: row.get(10)?,
        threshold: row.get(11)?,
        document_count: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn map_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeItem> {
    let item_type: String = row.get(3)?;
    let data: String = row.get(4)?;
    let status: String = row.get(5)?;
    Ok(KnowledgeItem {
        id: row.get(0)?,
        base_id: row.get(1)?,
        group_id: row.get(2)?,
        item_type: KnowledgeItemType::parse(&item_type).unwrap_or(KnowledgeItemType::File),
        data: serde_json::from_str(&data).unwrap_or(Value::Null),
        status: KnowledgeItemStatus::parse(&status).unwrap_or(KnowledgeItemStatus::Failed),
        error: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
