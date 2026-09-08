//! Controller-side encrypted cache and cursor recovery. No runtime work lives
//! here: closing the subscriber only stops observing the target host.
use super::{
    account::{AccountClient, AccountSession},
    encryption::decrypt_from_base64,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, mpsc, oneshot};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    seq: u64,
    content: Content,
}
#[derive(Deserialize)]
struct Content {
    c: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    messages: Vec<Message>,
    has_more: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fragment {
    v: u8,
    event_id: String,
    index: usize,
    count: usize,
    data: String,
}
#[derive(Deserialize)]
struct Ciphertext {
    nonce: String,
    data: String,
}
#[derive(Deserialize)]
pub struct SessionEvent {
    pub session_id: String,
    pub event: String,
    pub payload: serde_json::Value,
}

pub struct SessionSubscriber {
    older: mpsc::Sender<oneshot::Sender<Result<()>>>,
    worker: tokio::task::JoinHandle<()>,
}
impl SessionSubscriber {
    pub async fn start(
        account: AccountSession,
        relay: String,
        target: String,
        session_id: String,
        emit: Arc<dyn Fn(SessionEvent) -> Result<()> + Send + Sync>,
        error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<Self> {
        let mut updates = account.session_updates();
        let grant = AccountClient::new()
            .device_rpc(
                &relay,
                &account,
                &target,
                &serde_json::json!({"cmd":"get_session_key","session_id":session_id}).to_string(),
            )
            .await?;
        let grant: serde_json::Value = serde_json::from_str(&grant)?;
        let key = grant["key"]
            .as_str()
            .context("session key unavailable")?
            .to_owned();
        let wire_id = grant["relay_session_id"]
            .as_str()
            .context("session stream unavailable")?
            .to_owned();
        if grant["session_id"].as_str() != Some(&session_id) {
            bail!("session grant identity mismatch");
        }
        let binding = serde_json::to_vec(&(&relay, &account.user_id, &target, &session_id))?;
        let directory = super::product_home_dir()
            .context("product home unavailable")?
            .join("relay-session-cache")
            .join(format!("{:x}", Sha256::digest(binding)));
        tokio::fs::create_dir_all(&directory).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).await?;
        }
        let (older, mut older_requests) = mpsc::channel::<oneshot::Sender<Result<()>>>(1);
        let worker = tokio::spawn(async move {
            let client = super::relay_http::relay_http_client();
            let mut replica = Replica {
                directory,
                cursor: 0,
                parts: Vec::new(),
                event_id: None,
                count: 0,
                total: 0,
                key,
                session_id,
                emit,
            };
            if let Err(failure) = replica.replay().await {
                error(failure.to_string());
                return;
            }
            let mut oldest = replica.cached_start().await.unwrap_or(1);
            let mut has_more = oldest > 1;
            let mut retry = 1;
            loop {
                let result = async {
                    if replica.cursor == 0 {
                        let page = read_before(
                            &client,
                            &relay,
                            &account.token,
                            &wire_id,
                            9_007_199_254_740_991,
                        )
                        .await?;
                        if let Some(first) = page.messages.first() {
                            oldest = first.seq;
                            replica.cursor = oldest - 1;
                            has_more = page.has_more;
                            replica.save_start(oldest).await?;
                            for message in page.messages {
                                replica.apply(message).await?;
                            }
                        }
                    }
                    loop {
                        let page: Page = client
                            .get(format!(
                                "{}/v3/sessions/{}/messages?after_seq={}",
                                relay.trim_end_matches('/'),
                                urlencoding::encode(&wire_id),
                                replica.cursor
                            ))
                            .bearer_auth(&account.token)
                            .send()
                            .await?
                            .error_for_status()?
                            .json()
                            .await?;
                        for message in page.messages {
                            replica.apply(message).await?;
                        }
                        if !page.has_more {
                            break;
                        }
                    }
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                if let Err(failure) = result {
                    error(failure.to_string());
                    tokio::time::sleep(std::time::Duration::from_secs(retry)).await;
                    retry = (retry * 2).min(30);
                    continue;
                }
                retry = 1;
                let ready = || SessionEvent {
                    session_id: replica.session_id.clone(),
                    event: "relay://session-ready".into(),
                    payload: serde_json::json!({"sessionId":replica.session_id,"hasMore":has_more,"oldestSeq":oldest,"cursor":replica.cursor}),
                };
                if let Err(failure) = (replica.emit)(ready()) {
                    error(failure.to_string());
                }
                loop {
                    let update = tokio::select! {
                        update=updates.recv()=>update,
                        request=older_requests.recv()=>{
                            let Some(reply)=request else{return;};
                            if reply.is_closed() { continue; }
                            let result=async {
                                if !has_more {
                                    (replica.emit)(SessionEvent{session_id:replica.session_id.clone(),event:"relay://session-ready".into(),payload:serde_json::json!({"sessionId":replica.session_id,"hasMore":false,"oldestSeq":oldest,"cursor":replica.cursor})})?;
                                    return Ok(());
                                }
                                let page=read_before(&client,&relay,&account.token,&wire_id,oldest).await?;
                                if let Some(first)=page.messages.first(){
                                    let start=first.seq;
                                    let mut history=Replica{directory:replica.directory.clone(),cursor:start-1,parts:Vec::new(),event_id:None,count:0,total:0,key:replica.key.clone(),session_id:replica.session_id.clone(),emit:replica.emit.clone()};
                                    for message in page.messages {history.apply(message).await?;}
                                    history.save_start(start).await?;oldest=start;
                                }
                                has_more=page.has_more;
                                (replica.emit)(SessionEvent{session_id:replica.session_id.clone(),event:"relay://session-ready".into(),payload:serde_json::json!({"sessionId":replica.session_id,"hasMore":has_more,"oldestSeq":oldest,"cursor":replica.cursor})})?;
                                Ok(())
                            }.await;
                            let _=reply.send(result);continue;
                        }
                    };
                    match update {
                        Ok(None) | Err(broadcast::error::RecvError::Lagged(_)) => break,
                        Ok(Some((id, value))) if id == wire_id => {
                            match serde_json::from_value::<Message>(value) {
                                Ok(message) if message.seq <= replica.cursor => {}
                                Ok(message) if message.seq == replica.cursor + 1 => {
                                    if let Err(failure) = replica.apply(message).await {
                                        error(failure.to_string());
                                        break;
                                    }
                                }
                                _ => break,
                            }
                        }
                        Ok(_) => {}
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
        });
        Ok(Self { worker, older })
    }
    pub fn load_older(&self) -> impl std::future::Future<Output = Result<()>> + Send + 'static {
        let older = self.older.clone();
        async move {
            let (send, receive) = oneshot::channel();
            tokio::time::timeout(std::time::Duration::from_secs(120), async {
                older
                    .send(send)
                    .await
                    .map_err(|_| anyhow::anyhow!("Session subscriber closed"))?;
                receive.await.context("Session subscriber closed")?
            })
            .await
            .context("Session history page timed out")?
        }
    }
    pub fn close(&self) {
        self.worker.abort();
    }
}
impl Drop for SessionSubscriber {
    fn drop(&mut self) {
        self.close();
    }
}

async fn read_before(
    client: &reqwest::Client,
    relay: &str,
    token: &str,
    session: &str,
    before: u64,
) -> Result<Page> {
    let mut cursor = before;
    let mut messages = Vec::new();
    loop {
        let page: Page = client
            .get(format!(
                "{}/v3/sessions/{}/messages?before_seq={cursor}&limit=100",
                relay.trim_end_matches('/'),
                urlencoding::encode(session)
            ))
            .bearer_auth(token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let has_more = page.has_more;
        if page.messages.is_empty() {
            return Ok(Page {
                messages,
                has_more: false,
            });
        }
        let next = page
            .messages
            .iter()
            .map(|message| message.seq)
            .min()
            .context("empty history page")?;
        if next >= cursor {
            bail!("Session history cursor did not advance");
        }
        messages.extend(page.messages);
        messages.sort_by_key(|message| message.seq);
        let first: Fragment = serde_json::from_str(&messages[0].content.c)?;
        if first.index == 0 {
            return Ok(Page { messages, has_more });
        }
        if !has_more {
            bail!("Session history begins with an incomplete event");
        }
        cursor = next;
    }
}

struct Replica {
    directory: PathBuf,
    cursor: u64,
    parts: Vec<u8>,
    event_id: Option<String>,
    count: usize,
    total: usize,
    key: String,
    session_id: String,
    emit: Arc<dyn Fn(SessionEvent) -> Result<()> + Send + Sync>,
}
impl Replica {
    async fn cached_start(&self) -> Result<u64> {
        match tokio::fs::read_to_string(self.directory.join("start")).await {
            Ok(value) => Ok(value.parse()?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(1),
            Err(error) => Err(error.into()),
        }
    }
    async fn save_start(&self, start: u64) -> Result<()> {
        let temporary = self
            .directory
            .join(format!(".start-{}", uuid::Uuid::new_v4()));
        tokio::fs::write(&temporary, start.to_string()).await?;
        tokio::fs::rename(temporary, self.directory.join("start")).await?;
        Ok(())
    }
    async fn replay(&mut self) -> Result<()> {
        self.cursor = self.cached_start().await?.saturating_sub(1);
        loop {
            let path = self.directory.join(format!("{:020}.json", self.cursor + 1));
            match tokio::fs::read(path).await {
                Ok(bytes) => {
                    let complete = self.decode(&String::from_utf8(bytes)?)?;
                    if complete {
                        self.finish_event();
                    }
                    self.cursor += 1;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error.into()),
            }
        }
    }
    async fn apply(&mut self, message: Message) -> Result<()> {
        if message.seq != self.cursor + 1 {
            bail!("session receive sequence gap");
        }
        // Keep the pre-apply state if authentication/reducer fails so retry
        // starts at exactly the same fragment, without duplicated bytes.
        let old_length = self.parts.len();
        let old_id = self.event_id.clone();
        let old_count = self.count;
        let old_total = self.total;
        let complete = match self.decode(&message.content.c) {
            Ok(complete) => complete,
            Err(error) => {
                self.parts.truncate(old_length);
                self.event_id = old_id;
                self.count = old_count;
                self.total = old_total;
                return Err(error);
            }
        };
        let path = self.directory.join(format!("{:020}.json", message.seq));
        let temporary = self
            .directory
            .join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let content = message.content.c;
        let result = tokio::task::spawn_blocking(move || -> Result<()> {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(temporary, &path)?;
            #[cfg(unix)]
            std::fs::File::open(path.parent().context("cache parent unavailable")?)?.sync_all()?;
            Ok(())
        })
        .await?;
        if let Err(error) = result {
            self.parts.truncate(old_length);
            self.event_id = old_id;
            self.count = old_count;
            self.total = old_total;
            return Err(error);
        }
        if complete {
            self.finish_event();
        }
        self.cursor = message.seq;
        Ok(())
    }
    fn decode(&mut self, content: &str) -> Result<bool> {
        let part: Fragment = serde_json::from_str(content)?;
        if part.v != 1 || part.count == 0 || part.index >= part.count {
            bail!("invalid session fragment");
        }
        if part.index == 0 {
            if self.event_id.is_some() {
                bail!("incomplete preceding session event");
            }
            self.event_id = Some(part.event_id.clone());
            self.count = 0;
            self.total = part.count;
        }
        if self.event_id.as_deref() != Some(&part.event_id)
            || self.count != part.index
            || self.total != part.count
        {
            bail!("session fragment order mismatch");
        }
        self.parts.extend(STANDARD.decode(part.data)?);
        self.count += 1;
        if self.count == part.count {
            let cipher: Ciphertext = serde_json::from_slice(&self.parts)?;
            let key = super::encryption::parse_public_key(&self.key)?;
            let event: SessionEvent =
                serde_json::from_str(&decrypt_from_base64(&key, &cipher.data, &cipher.nonce)?)?;
            if event.session_id != self.session_id {
                bail!("session encryption binding mismatch");
            }
            (self.emit)(event)?;
            return Ok(true);
        }
        Ok(false)
    }
    fn finish_event(&mut self) {
        self.parts.clear();
        self.event_id = None;
        self.count = 0;
        self.total = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vector() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../../../shared/relay-transport/session-cipher.fixture.json"
        ))
        .unwrap()
    }
    #[tokio::test]
    async fn latest_window_restart_does_not_require_seq_one() {
        let vector = vector();
        let directory = tempfile::tempdir().unwrap();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let emitted = count.clone();
        let callback: Arc<dyn Fn(SessionEvent) -> Result<()> + Send + Sync> = Arc::new(move |_| {
            emitted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        });
        let make = || Replica {
            directory: directory.path().to_owned(),
            cursor: 0,
            parts: vec![],
            event_id: None,
            count: 0,
            total: 0,
            key: vector["key"].as_str().unwrap().into(),
            session_id: vector["sessionId"].as_str().unwrap().into(),
            emit: callback.clone(),
        };
        let mut replica = make();
        replica.save_start(100).await.unwrap();
        replica.cursor = 99;
        for (index, part) in vector["fragments"].as_array().unwrap().iter().enumerate() {
            replica
                .apply(Message {
                    seq: 100 + index as u64,
                    content: Content {
                        c: part.to_string(),
                    },
                })
                .await
                .unwrap();
        }
        let last = replica.cursor;
        drop(replica);
        let mut restarted = make();
        restarted.replay().await.unwrap();
        assert_eq!(restarted.cursor, last);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(!directory.path().join("00000000000000000001.json").exists());
    }

    #[tokio::test]
    async fn restart_mid_fragment_recovers_and_auth_failure_preserves_cursor() {
        let vector = vector();
        let directory = tempfile::tempdir().unwrap();
        let emitted = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output = emitted.clone();
        let callback: Arc<dyn Fn(SessionEvent) -> Result<()> + Send + Sync> = Arc::new(move |_| {
            output.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        });
        let make = || Replica {
            directory: directory.path().to_owned(),
            cursor: 0,
            parts: Vec::new(),
            event_id: None,
            count: 0,
            total: 0,
            key: vector["key"].as_str().unwrap().into(),
            session_id: vector["sessionId"].as_str().unwrap().into(),
            emit: callback.clone(),
        };
        let fragments = vector["fragments"].as_array().unwrap();
        let mut replica = make();
        replica
            .apply(Message {
                seq: 1,
                content: Content {
                    c: fragments[0].to_string(),
                },
            })
            .await
            .unwrap();
        drop(replica);
        let mut replica = make();
        replica.replay().await.unwrap();
        assert_eq!(replica.cursor, 1);
        for (index, fragment) in fragments.iter().enumerate().skip(1) {
            replica
                .apply(Message {
                    seq: index as u64 + 1,
                    content: Content {
                        c: fragment.to_string(),
                    },
                })
                .await
                .unwrap();
        }
        assert_eq!(emitted.load(std::sync::atomic::Ordering::SeqCst), 1);
        let cursor = replica.cursor;
        let mut corrupt = fragments[0].clone();
        corrupt["count"] = serde_json::json!(1);
        assert!(replica
            .apply(Message {
                seq: cursor + 1,
                content: Content {
                    c: corrupt.to_string()
                }
            })
            .await
            .is_err());
        assert_eq!(replica.cursor, cursor);
        assert!(replica.parts.is_empty());
        assert!(!directory
            .path()
            .join(format!("{:020}.json", cursor + 1))
            .exists());
    }
}
