//! Durable encrypted session publication. Network acknowledgements advance only
//! the upload cursor; the local journal remains available after restart.
use super::encryption::{decrypt_from_base64, encrypt_to_base64};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingMessage {
    pub local_id: String,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
struct Ciphertext {
    nonce: String,
    data: String,
}

#[derive(Serialize, Deserialize)]
struct BoundEvent {
    session_id: String,
    event: String,
    payload: serde_json::Value,
}

/// One local owner per (account, machine, session). Files are private and keys
/// are randomly generated, never derived from public account identifiers.
#[derive(Clone)]
pub struct SessionLog {
    directory: PathBuf,
    session_id: String,
}

impl SessionLog {
    pub fn open(root: &Path, account: &str, machine: &str, session: &str) -> Result<Self> {
        let binding = serde_json::to_vec(&(account, machine, session))?;
        let directory = root.join(format!("{:x}", Sha256::digest(&binding)));
        fs::create_dir_all(&directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        let log = Self {
            directory,
            session_id: session.to_owned(),
        };
        let _lock = log.lock()?;
        if !log.directory.join("key").exists() {
            let mut key = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            log.atomic_write("key", &key)?;
        }
        log.key()?;
        if !log.directory.join("identity").exists() {
            log.atomic_write("identity", &binding)?;
        }
        Ok(log)
    }

    pub fn for_host(account: &str, machine: &str, session: &str) -> Result<Self> {
        let root = super::product_home_dir()
            .context("product home unavailable")?
            .join("relay-session-log");
        Self::open(&root, account, machine, session)
    }

    /// Grant lookup never creates a session or repairs missing data.
    pub fn existing_for_host(account: &str, machine: &str, session: &str) -> Result<Self> {
        let root = super::product_home_dir()
            .context("product home unavailable")?
            .join("relay-session-log");
        let binding = serde_json::to_vec(&(account, machine, session))?;
        let directory = root.join(format!("{:x}", Sha256::digest(&binding)));
        if fs::read(directory.join("identity")).context("session log unavailable")? != binding {
            bail!("session log identity mismatch");
        }
        let log = Self {
            directory,
            session_id: session.to_owned(),
        };
        log.key()?;
        Ok(log)
    }

    fn lock(&self) -> Result<File> {
        let file = private_file(&self.directory.join("lock"), false)?;
        file.lock_exclusive()?;
        Ok(file)
    }

    fn key(&self) -> Result<[u8; 32]> {
        let bytes = fs::read(self.directory.join("key"))?;
        bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid session encryption key; journal preserved"))
    }

    pub fn relay_session_id(&self) -> String {
        self.directory
            .file_name()
            .expect("session log directory has an identity")
            .to_string_lossy()
            .into_owned()
    }

    /// Call only inside an authenticated, end-to-end encrypted peer response.
    pub fn key_grant(&self) -> Result<String> {
        Ok(STANDARD.encode(self.key()?))
    }

    /// Commit before notifying the uploader. No network operation holds the
    /// filesystem lock. A stable ID and ciphertext survive uncertain ACKs.
    pub fn append(&self, event: &str, payload: serde_json::Value) -> Result<PendingMessage> {
        self.append_batch(vec![(event.to_owned(), payload)])?
            .pop()
            .context("empty journal append")
    }

    /// A whole producer microbatch commits with one atomic segment rename.
    /// A crash exposes either every record in the batch or none of them.
    pub fn append_batch(
        &self,
        events: Vec<(String, serde_json::Value)>,
    ) -> Result<Vec<PendingMessage>> {
        if events.is_empty() {
            return Ok(Vec::new());
        }
        let _lock = self.lock()?;
        self.append_batch_locked(events)
    }

    fn append_batch_locked(
        &self,
        events: Vec<(String, serde_json::Value)>,
    ) -> Result<Vec<PendingMessage>> {
        let start = self
            .last_sequence()?
            .checked_add(1)
            .context("session sequence exhausted")?;
        let end = start
            .checked_add(events.len() as u64 - 1)
            .context("session sequence exhausted")?;
        let key = self.key()?;
        let mut messages = Vec::with_capacity(events.len());
        for (index, (event, mut payload)) in events.into_iter().enumerate() {
            if event == "session-record" {
                payload["revision"] = serde_json::json!(start + index as u64);
            }
            let plaintext = serde_json::to_string(&BoundEvent {
                session_id: self.session_id.clone(),
                event,
                payload,
            })?;
            let (data, nonce) = encrypt_to_base64(&key, &plaintext)?;
            messages.push(PendingMessage {
                local_id: format!("{:020}", start + index as u64),
                content: serde_json::to_string(&Ciphertext { nonce, data })?,
            });
        }
        self.atomic_write(
            &format!("{start:020}-{end:020}.batch"),
            &serde_json::to_vec(&messages)?,
        )?;
        Ok(messages)
    }

    /// The caller serializes source reads with this session's publication owner.
    /// An index failure after a log commit can produce a duplicate on retry, but
    /// cannot lose a record; stable IDs/revisions make that duplicate harmless.
    pub fn append_records(&self, records: Vec<serde_json::Value>, full: bool) -> Result<()> {
        let _lock = self.lock()?;
        let index_path = self.directory.join("record-index");
        let mut index: std::collections::BTreeMap<String, serde_json::Value> =
            match fs::read(&index_path) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .context("invalid record index; journal preserved")?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Default::default(),
                Err(error) => return Err(error.into()),
            };
        let mut changed = Vec::new();
        let mut present = std::collections::BTreeSet::new();
        let mut scope = std::collections::BTreeSet::new();
        for record in records {
            let id = record["id"]
                .as_str()
                .context("record identity missing")?
                .to_owned();
            present.insert(id.clone());
            let turn = record["turn"]["turnId"]
                .as_str()
                .context("record turn identity missing")?
                .to_owned();
            scope.insert(turn.clone());
            if record["sessionId"].as_str() != Some(self.session_id.as_str()) {
                bail!("record session identity mismatch");
            }
            // Parent status changes get their own small header record; they
            // must not re-upload every unchanged large tool body.
            let body = record
                .get("item")
                .or_else(|| record.get("round"))
                .unwrap_or(&record["turn"]);
            let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(body)?));
            let old_hash = index
                .get(&id)
                .and_then(|entry| entry.as_str().or_else(|| entry["hash"].as_str()));
            if old_hash != Some(hash.as_str()) {
                index.insert(id, serde_json::json!({"hash":hash,"turn":turn}));
                changed.push(("session-record".into(), record));
            }
        }
        let removed: Vec<_> = index
            .iter()
            .filter(|(id, entry)| {
                !present.contains(*id)
                    && (full
                        || entry["turn"]
                            .as_str()
                            .is_some_and(|turn| scope.contains(turn)))
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in removed {
            index.remove(&id);
            changed.push((
                "session-record".into(),
                serde_json::json!({"sessionId":self.session_id,"id":id,"deleted":true}),
            ));
        }
        if changed.is_empty() {
            return Ok(());
        }
        self.append_batch_locked(changed)?;
        self.atomic_write("record-index", &serde_json::to_vec(&index)?)
    }

    fn segments(&self) -> Result<Vec<(u64, u64, PathBuf)>> {
        let mut segments = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(sequence) = name
                .strip_suffix(".json")
                .and_then(|n| n.parse::<u64>().ok())
            {
                segments.push((sequence, sequence, entry.path()));
            } else if let Some((start, end)) =
                name.strip_suffix(".batch").and_then(|n| n.split_once('-'))
            {
                let (start, end) = (start.parse::<u64>()?, end.parse::<u64>()?);
                if start == 0 || end < start {
                    bail!("invalid journal segment; journal preserved");
                }
                segments.push((start, end, entry.path()));
            }
        }
        segments.sort_by_key(|(start, _, _)| *start);
        Ok(segments)
    }

    fn last_sequence(&self) -> Result<u64> {
        Ok(self
            .segments()?
            .iter()
            .map(|(_, end, _)| *end)
            .max()
            .unwrap_or(0))
    }

    fn acknowledged(&self) -> Result<u64> {
        match fs::read_to_string(self.directory.join("uploaded")) {
            Ok(value) => Ok(value
                .parse()
                .context("invalid upload cursor; journal preserved")?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(error) => Err(error.into()),
        }
    }

    /// Small batches bound memory, not journal size. The caller drains all
    /// batches, so a large session does not fail because of an arbitrary quota.
    pub fn pending(&self, batch_size: usize) -> Result<Vec<PendingMessage>> {
        let _lock = self.lock()?;
        self.read_after(self.acknowledged()?, batch_size)
    }

    fn read_after(&self, cursor: u64, batch_size: usize) -> Result<Vec<PendingMessage>> {
        if batch_size == 0 {
            return Ok(Vec::new());
        }
        let mut messages = Vec::new();
        let mut next = cursor
            .checked_add(1)
            .context("session sequence exhausted")?;
        for (start, end, path) in self.segments()? {
            if end < next {
                continue;
            }
            if start > next {
                bail!("session journal has a missing record; journal preserved");
            }
            let bytes = fs::read(&path)?;
            let batch: Vec<PendingMessage> = if path.extension().is_some_and(|e| e == "json") {
                vec![serde_json::from_slice(&bytes)?]
            } else {
                serde_json::from_slice(&bytes)?
            };
            if batch.len() as u64 != end - start + 1 {
                bail!("incomplete journal batch; journal preserved");
            }
            for (index, message) in batch.into_iter().enumerate() {
                let sequence = start + index as u64;
                if message.local_id != format!("{sequence:020}") {
                    bail!("journal message identity mismatch");
                }
                if sequence < next {
                    continue;
                }
                messages.push(message);
                next += 1;
                if messages.len() == batch_size {
                    return Ok(messages);
                }
            }
        }
        Ok(messages)
    }

    /// ACK exactly the submitted prefix, never accept a receive cursor or an
    /// unrelated server sequence as proof that an upload succeeded.
    pub fn acknowledge(&self, messages: &[PendingMessage]) -> Result<()> {
        let _lock = self.lock()?;
        let cursor = self.acknowledged()?;
        let mut fresh = Vec::new();
        for message in messages {
            let sequence: u64 = message.local_id.parse()?;
            if sequence > cursor {
                fresh.push(message.clone());
            }
        }
        if fresh.is_empty() {
            return Ok(());
        }
        if self.read_after(cursor, fresh.len())? != fresh {
            bail!("upload acknowledgement does not match contiguous journal prefix");
        }
        let next = fresh
            .last()
            .context("empty acknowledgement")?
            .local_id
            .parse::<u64>()?;
        self.atomic_write("uploaded", next.to_string().as_bytes())
    }

    pub fn decrypt(&self, content: &str) -> Result<(String, serde_json::Value)> {
        let cipher: Ciphertext = serde_json::from_str(content)?;
        let event: BoundEvent = serde_json::from_str(&decrypt_from_base64(
            &self.key()?,
            &cipher.data,
            &cipher.nonce,
        )?)?;
        if event.session_id != self.session_id {
            bail!("session encryption binding mismatch");
        }
        Ok((event.event, event.payload))
    }

    fn atomic_write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let temporary = self
            .directory
            .join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let mut file = private_file(&temporary, true)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, self.directory.join(name))?;
        #[cfg(unix)]
        File::open(&self.directory)?.sync_all()?;
        Ok(())
    }
}

fn private_file(path: &Path, exclusive: bool) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).read(true);
    if exclusive {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

/// HTTP is the durable data lane; Socket.IO notifications wake readers. One
/// drain owns upload order. Call again after a network error with the same log.
pub async fn upload_pending(
    log: &SessionLog,
    client: &reqwest::Client,
    relay: &str,
    token: &str,
) -> Result<usize> {
    upload_round(log, client, relay, token, true).await
}

async fn upload_round(
    log: &SessionLog,
    client: &reqwest::Client,
    relay: &str,
    token: &str,
    drain: bool,
) -> Result<usize> {
    let base = relay.trim_end_matches('/');
    let mut uploaded = 0;
    loop {
        let reader = log.clone();
        let messages = tokio::task::spawn_blocking(move || reader.pending(50)).await??;
        if messages.is_empty() {
            return Ok(uploaded);
        }
        if uploaded == 0 {
            client
                .post(format!("{base}/v1/sessions"))
                .bearer_auth(token)
                .json(&serde_json::json!({"id":log.relay_session_id(),"metadata":"{}"}))
                .send()
                .await?
                .error_for_status()?;
        }
        let mut wire_batch = Vec::new();
        // Fragment the already-encrypted record. Stable fragment IDs survive
        // retries, including a response lost after only part of a large event.
        for message in &messages {
            let bytes = message.content.as_bytes();
            let count = bytes.len().div_ceil(48 * 1024);
            for (index, chunk) in bytes.chunks(48 * 1024).enumerate() {
                let fragment = PendingMessage {
                    local_id: format!("{}-{index}", message.local_id),
                    content: serde_json::to_string(&serde_json::json!({
                        "v":1,"eventId":message.local_id,"index":index,"count":count,
                        "data":STANDARD.encode(chunk)
                    }))?,
                };
                wire_batch.push(fragment);
                if wire_batch.len() == 50 {
                    upload_batch(client, base, token, &log.relay_session_id(), &wire_batch).await?;
                    wire_batch.clear();
                }
            }
        }
        if !wire_batch.is_empty() {
            upload_batch(client, base, token, &log.relay_session_id(), &wire_batch).await?;
        }
        uploaded += messages.len();
        let writer = log.clone();
        tokio::task::spawn_blocking(move || writer.acknowledge(&messages)).await??;
        if !drain {
            return Ok(uploaded);
        }
    }
}

async fn upload_batch(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    session_id: &str,
    messages: &[PendingMessage],
) -> Result<()> {
    let response: serde_json::Value = client
        .post(format!(
            "{base}/v3/sessions/{}/messages",
            urlencoding::encode(session_id)
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({"messages":messages}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let acknowledged = response
        .get("messages")
        .and_then(|v| v.as_array())
        .context("missing upload acknowledgements")?;
    if acknowledged.len() != messages.len() {
        bail!("incomplete upload acknowledgement");
    }
    for (ack, sent) in acknowledged.iter().zip(messages) {
        if ack.get("localId").and_then(|v| v.as_str()) != Some(sent.local_id.as_str())
            || ack.pointer("/content/c").and_then(|v| v.as_str()) != Some(sent.content.as_str())
        {
            bail!("invalid upload acknowledgement");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_preserves_key_ciphertext_and_pending_prefix() {
        let root = tempfile::tempdir().unwrap();
        let log = SessionLog::open(root.path(), "account", "machine", "session").unwrap();
        let a = log
            .append("start", serde_json::json!({"text":"hello"}))
            .unwrap();
        let b = log.append("end", serde_json::json!({})).unwrap();
        let key = log.key_grant().unwrap();
        drop(log);
        let log = SessionLog::open(root.path(), "account", "machine", "session").unwrap();
        assert_eq!(log.key_grant().unwrap(), key);
        assert_eq!(log.pending(50).unwrap(), [a.clone(), b.clone()]);
        assert!(log.acknowledge(&[b.clone()]).is_err());
        log.acknowledge(&[a.clone()]).unwrap();
        assert_eq!(log.pending(50).unwrap(), [b]);
        assert_eq!(log.decrypt(&a.content).unwrap().0, "start");
        assert!(SessionLog::open(root.path(), "account", "machine", "other")
            .unwrap()
            .decrypt(&a.content)
            .is_err());
    }
    #[tokio::test]
    #[ignore = "requires an isolated source Relay and its machine token"]
    async fn source_relay_large_session_round_trip() {
        let relay = std::env::var("RELAY_LAB_URL").expect("RELAY_LAB_URL");
        let token = std::env::var("RELAY_LAB_TOKEN").expect("RELAY_LAB_TOKEN");
        let root = tempfile::tempdir().unwrap();
        let session = format!("session-log-test-{}", uuid::Uuid::new_v4());
        let log = SessionLog::open(root.path(), "isolated-test", "source-host", &session).unwrap();
        let body = "large session payload ".repeat(100_000);
        let original = log
            .append("test-event", serde_json::json!({"body":body}))
            .unwrap();
        let client = super::super::relay_http::relay_http_client();
        assert_eq!(
            upload_pending(&log, &client, &relay, &token).await.unwrap(),
            1
        );
        assert_eq!(
            upload_pending(&log, &client, &relay, &token).await.unwrap(),
            0
        );
        let mut cursor = 0;
        let mut assembled = Vec::new();
        loop {
            let response: serde_json::Value = client
                .get(format!(
                    "{}/v3/sessions/{}/messages?after_seq={cursor}",
                    relay.trim_end_matches('/'),
                    log.relay_session_id()
                ))
                .bearer_auth(&token)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap();
            for message in response["messages"].as_array().unwrap() {
                assert_eq!(message["seq"].as_u64().unwrap(), cursor + 1);
                cursor += 1;
                let part: serde_json::Value =
                    serde_json::from_str(message["content"]["c"].as_str().unwrap()).unwrap();
                assembled.extend(STANDARD.decode(part["data"].as_str().unwrap()).unwrap());
            }
            if !response["hasMore"].as_bool().unwrap() {
                break;
            }
        }
        assert!(cursor > 50, "large event crosses upload and read pages");
        assert_eq!(String::from_utf8(assembled).unwrap(), original.content);
        assert_eq!(log.decrypt(&original.content).unwrap().1["body"], body);
    }

    #[test]
    fn batch_commit_reads_legacy_records_and_recovers_partial_uploads() {
        let root = tempfile::tempdir().unwrap();
        let log = SessionLog::open(root.path(), "a", "m", "s").unwrap();
        let legacy = log.append("legacy", serde_json::json!({})).unwrap();
        fs::write(
            log.directory.join("00000000000000000001.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        fs::remove_file(
            log.directory
                .join("00000000000000000001-00000000000000000001.batch"),
        )
        .unwrap();
        fs::write(log.directory.join(".interrupted.tmp"), b"partial").unwrap();
        let start = std::time::Instant::now();
        for batch in 0..16 {
            log.append_batch(
                (0..64)
                    .map(|i| ("event".into(), serde_json::json!({"index":batch*64+i})))
                    .collect(),
            )
            .unwrap();
        }
        eprintln!("Session journal: 1024 events in {:?}", start.elapsed());
        let prefix = log.pending(50).unwrap();
        assert_eq!(prefix[0], legacy);
        log.acknowledge(&prefix).unwrap();
        let tail = log.pending(2000).unwrap();
        assert_eq!(tail.len(), 975);
        assert_eq!(tail.first().unwrap().local_id, "00000000000000000051");
        assert_eq!(tail.last().unwrap().local_id, "00000000000000001025");
        log.acknowledge(&tail).unwrap();
        assert!(log.pending(1).unwrap().is_empty());
        assert!(log.directory.join(".interrupted.tmp").exists());
    }

    #[test]
    fn stable_records_preserve_large_bodies_and_scoped_tombstones() {
        let root = tempfile::tempdir().unwrap();
        let log = SessionLog::open(root.path(), "a", "m", "s").unwrap();
        let turn = |id: &str, status: &str| serde_json::json!({"sessionId":"s","id":format!("turn/{id}"),"turn":{"turnId":id,"sessionId":"s","status":status}});
        let mut item = serde_json::json!({"sessionId":"s","id":"item/tool","turn":{"turnId":"one","sessionId":"s","status":"inprogress"},"item":{"type":"tool","data":{"id":"tool","result":"x".repeat(1024*1024)}}});
        log.append_records(
            vec![
                turn("one", "inprogress"),
                item.clone(),
                turn("two", "completed"),
            ],
            true,
        )
        .unwrap();
        assert_eq!(log.pending(50).unwrap().len(), 3);
        item["turn"]["status"] = serde_json::json!("completed");
        log.append_records(vec![turn("one", "completed"), item.clone()], false)
            .unwrap();
        let records = log.pending(50).unwrap();
        assert_eq!(
            records.len(),
            4,
            "parent state must not retransmit large unchanged tool output or remove unrelated turn"
        );
        log.append_records(vec![turn("one", "completed")], false)
            .unwrap();
        let records = log.pending(50).unwrap();
        assert_eq!(records.len(), 5);
        let deleted = log.decrypt(&records[4].content).unwrap().1;
        assert_eq!(deleted["id"], "item/tool");
        assert_eq!(deleted["deleted"], true);
        assert_eq!(deleted["revision"], 5);
        log.append_records(vec![turn("one", "completed"), item], false)
            .unwrap();
        let records = log.pending(50).unwrap();
        assert_eq!(records.len(), 6);
        assert_eq!(log.decrypt(&records[5].content).unwrap().1["revision"], 6);
    }

    #[tokio::test]
    async fn publisher_establishes_reserved_catalog_and_closes_observers() {
        let root = tempfile::tempdir().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let relay = format!("http://{}", listener.local_addr().unwrap());
        let publisher = SessionPublisher::start(
            root.path().into(),
            "account".into(),
            "host".into(),
            relay,
            "fixture".into(),
        )
        .await
        .unwrap();
        assert!(openbitfun_core_types::validate_session_id(HOST_CATALOG_ID).is_err());
        let log = SessionLog::open(root.path(), "account", "host", HOST_CATALOG_ID).unwrap();
        let pending = log.pending(10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(
            log.decrypt(&pending[0].content).unwrap().0,
            "host-catalog-changed"
        );
        let closed = publisher.subscribe_closed();
        publisher.close();
        assert!(*closed.borrow());
        drop(listener);
    }

    #[test]
    fn concurrent_writers_and_corruption_preserve_records() {
        let root = tempfile::tempdir().unwrap();
        let log = SessionLog::open(root.path(), "a", "m", "s").unwrap();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let log = log.clone();
                scope.spawn(move || {
                    for _ in 0..10 {
                        log.append("event", serde_json::json!({})).unwrap();
                    }
                });
            }
        });
        let records = log.pending(100).unwrap();
        assert_eq!(records.len(), 80);
        log.acknowledge(&records).unwrap();
        assert!(log.pending(1).unwrap().is_empty());
        fs::write(log.directory.join("key"), b"corrupt").unwrap();
        assert!(SessionLog::open(root.path(), "a", "m", "s").is_err());
        assert_eq!(log.last_sequence().unwrap(), 80);
    }
}

/// Contains a separator rejected by runtime Session IDs, so control metadata
/// cannot alias a user's session.
pub const HOST_CATALOG_ID: &str = "@host/catalog";

/// Account-scoped uploader: events are committed locally before returning;
/// notifications coalesce while the network is unavailable. Dropping the owner
/// stops network work without deleting pending messages.
pub struct SessionPublisher {
    source_gates: tokio::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>,
    >,
    root: PathBuf,
    account: String,
    machine: String,
    logs: std::sync::Arc<tokio::sync::Mutex<std::collections::BTreeMap<String, SessionLog>>>,
    wake: std::sync::Arc<tokio::sync::Notify>,
    worker: tokio::task::JoinHandle<()>,
    closed: tokio::sync::watch::Sender<bool>,
}

impl SessionPublisher {
    pub fn close(&self) {
        self.closed.send_replace(true);
        self.worker.abort();
    }

    pub fn subscribe_closed(&self) -> tokio::sync::watch::Receiver<bool> {
        self.closed.subscribe()
    }

    pub async fn start_for_host(
        account: String,
        machine: String,
        relay: String,
        token: String,
    ) -> Result<Self> {
        let root = super::product_home_dir()
            .context("product home unavailable")?
            .join("relay-session-log");
        Self::start(root, account, machine, relay, token).await
    }
    pub async fn start(
        root: PathBuf,
        account: String,
        machine: String,
        relay: String,
        token: String,
    ) -> Result<Self> {
        let discover_root = root.clone();
        let discover_account = account.clone();
        let discover_machine = machine.clone();
        let known = tokio::task::spawn_blocking(
            move || -> Result<std::collections::BTreeMap<String, SessionLog>> {
                let mut known = std::collections::BTreeMap::new();
                if !discover_root.exists() {
                    return Ok(known);
                }
                for entry in fs::read_dir(&discover_root)? {
                    let path = entry?.path().join("identity");
                    if !path.exists() {
                        continue;
                    }
                    let (account, machine, session): (String, String, String) =
                        serde_json::from_slice(&fs::read(path)?)?;
                    if account == discover_account && machine == discover_machine {
                        known.insert(
                            session.clone(),
                            SessionLog::open(&discover_root, &account, &machine, &session)?,
                        );
                    }
                }
                Ok(known)
            },
        )
        .await??;
        let logs = std::sync::Arc::new(tokio::sync::Mutex::new(known));
        let wake = std::sync::Arc::new(tokio::sync::Notify::new());
        let worker_logs = logs.clone();
        let worker_wake = wake.clone();
        let worker = tokio::spawn(async move {
            let client = super::relay_http::relay_http_client();
            let mut retries: std::collections::BTreeMap<String, (tokio::time::Instant, u64)> =
                std::collections::BTreeMap::new();
            loop {
                let current: Vec<_> = worker_logs.lock().await.values().cloned().collect();
                let mut progressed = false;
                for log in current {
                    if retries
                        .get(&log.session_id)
                        .is_some_and(|(at, _)| *at > tokio::time::Instant::now())
                    {
                        continue;
                    }
                    match upload_round(&log, &client, &relay, &token, false).await {
                        Ok(count) => {
                            progressed |= count > 0;
                            retries.remove(&log.session_id);
                        }
                        Err(error) => {
                            log::warn!("Durable session upload deferred: {error}");
                            let delay = retries
                                .get(&log.session_id)
                                .map_or(1, |(_, delay)| (*delay * 2).min(30));
                            retries.insert(
                                log.session_id.clone(),
                                (
                                    tokio::time::Instant::now()
                                        + std::time::Duration::from_secs(delay),
                                    delay,
                                ),
                            );
                        }
                    }
                }
                if progressed {
                    continue;
                }
                if let Some(deadline) = retries.values().map(|(at, _)| *at).min() {
                    tokio::select! { _=tokio::time::sleep_until(deadline)=>{}, _=worker_wake.notified()=>{} }
                } else {
                    worker_wake.notified().await;
                }
            }
        });
        let publisher = Self {
            source_gates: Default::default(),
            root,
            account,
            machine,
            logs,
            wake,
            worker,
            closed: tokio::sync::watch::channel(false).0,
        };
        // Establish the host control namespace before granting any subscriber.
        publisher
            .append(
                HOST_CATALOG_ID.into(),
                "host-catalog-changed".into(),
                serde_json::json!({"sessionsRevision":0,"workspacesRevision":0}),
            )
            .await?;
        Ok(publisher)
    }

    /// A source delivery gap is explicit; controllers reconcile from the
    /// runtime's authoritative view. It must never cancel host-owned work.
    pub async fn session_ids(&self) -> Vec<String> {
        self.logs.lock().await.keys().cloned().collect()
    }

    pub async fn report_source_gap(&self, reason: &str) -> Result<()> {
        let sessions: Vec<_> = self.logs.lock().await.keys().cloned().collect();
        for session in sessions {
            self.append(
                session.clone(),
                "relay://session-gap".into(),
                serde_json::json!({"sessionId":session,"reason":reason}),
            )
            .await?;
        }
        Ok(())
    }

    pub async fn synchronize_records<F, Fut>(
        &self,
        session_id: String,
        full: bool,
        load: F,
    ) -> Result<()>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Vec<serde_json::Value>>>,
    {
        let gate = self
            .source_gates
            .lock()
            .await
            .entry(session_id.clone())
            .or_default()
            .clone();
        let _source = gate.lock().await;
        let records = load().await?;
        let root = self.root.clone();
        let account = self.account.clone();
        let machine = self.machine.clone();
        let log = tokio::task::spawn_blocking(move || -> Result<SessionLog> {
            let log = SessionLog::open(&root, &account, &machine, &session_id)?;
            log.append_records(records, full)?;
            Ok(log)
        })
        .await??;
        self.logs.lock().await.insert(log.session_id.clone(), log);
        self.wake.notify_one();
        Ok(())
    }

    pub async fn append(
        &self,
        session_id: String,
        event: String,
        payload: serde_json::Value,
    ) -> Result<()> {
        self.append_batch(vec![(session_id, event, payload)]).await
    }

    pub async fn append_batch(
        &self,
        events: Vec<(String, String, serde_json::Value)>,
    ) -> Result<()> {
        let root = self.root.clone();
        let account = self.account.clone();
        let machine = self.machine.clone();
        let logs = tokio::task::spawn_blocking(move || -> Result<Vec<SessionLog>> {
            let mut grouped: std::collections::BTreeMap<String, Vec<(String, serde_json::Value)>> =
                std::collections::BTreeMap::new();
            for (session, event, payload) in events {
                grouped.entry(session).or_default().push((event, payload));
            }
            let mut logs = Vec::new();
            for (session, events) in grouped {
                let log = SessionLog::open(&root, &account, &machine, &session)?;
                log.append_batch(events)?;
                logs.push(log);
            }
            Ok(logs)
        })
        .await??;
        let mut known = self.logs.lock().await;
        for log in logs {
            known.insert(log.session_id.clone(), log);
        }
        drop(known);
        self.wake.notify_one();
        Ok(())
    }
}

impl Drop for SessionPublisher {
    fn drop(&mut self) {
        self.close();
    }
}
