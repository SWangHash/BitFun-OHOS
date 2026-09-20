//! Bind Socket.IO lifetime to the account directory's revocation/presence owner.
use super::*;
use crate::relay::transport::OutboundMessage;
use tokio::sync::{mpsc, watch};

pub(super) async fn register(
    socket: &SocketRef,
    state: &AppState,
    identity: &Identity,
    io: &SocketIo,
) -> bool {
    let conn_id = state.device_manager.next_connection_id();
    let (tx, mut rx) = mpsc::channel::<OutboundMessage>(16);
    let (close_tx, mut close_rx) = watch::channel(false);
    let disconnect_tx = close_tx.clone();
    socket.on_disconnect(move || {
        let tx = disconnect_tx.clone();
        async move {
            let _ = tx.send(true);
        }
    });
    let row = match sqlx::query_as::<_, crate::db::DeviceRow>(
        "SELECT * FROM devices WHERE user_id=? AND device_id=?",
    )
    .bind(&identity.account)
    .bind(&identity.device)
    .fetch_optional(&*state.db)
    .await
    {
        Ok(Some(row)) => row,
        _ => return false,
    };
    if !socket.connected() {
        return false;
    }
    let name = row.device_name.as_deref().unwrap_or("BitFun");
    state.device_manager.register_pending(
        &identity.account,
        &identity.device,
        &identity.token,
        name,
        conn_id,
        tx,
        close_tx.clone(),
    );
    let activated = super::device_lifecycle::activate_pending_device_if_authorized(
        &state.db,
        &state.device_manager,
        &identity.token,
        &identity.account,
        &identity.device,
        name,
        row.device_kind.as_deref(),
        conn_id,
    )
    .await
    .unwrap_or(false);
    if !activated {
        state.device_manager.unregister(conn_id);
        return false;
    }
    let state = state.clone();
    let io = io.clone();
    let socket = socket.clone();
    let (account, device) = (identity.account.clone(), identity.device.clone());
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _=close_rx.changed()=>break,
                message=rx.recv()=>{
                    // Account directory messages are lifecycle notifications.
                    // Payload/RPC routing belongs exclusively to Socket.IO.
                    if message.is_none(){break;}
                }
            }
        }
        let _ = socket.disconnect();
        let _guard = state.device_manager.lock_presence_projection().await;
        state.device_manager.unregister(conn_id);
        if !state.device_manager.is_device_online(&account, &device) {
            let _ = crate::db::DeviceRow::set_online(&state.db, &account, &device, false).await;
        }
        // Logout/delete may already remove the directory mapping before the
        // socket observes cancellation. Broadcast the current owner state in
        // either case, without marking a replacement connection offline.
        broadcast(&io, &state, &account).await;
    });
    true
}
pub(crate) async fn broadcast(io: &SocketIo, state: &AppState, account: &str) {
    let devices: Vec<_> = match crate::db::DeviceRow::list_by_user(&state.db, account).await {
        Ok(rows) => rows.into_iter().filter(|row| state.device_manager.is_device_online(account, &row.device_id)).map(|row| json!({"device_id":row.device_id,"device_name":row.device_name.unwrap_or_default(),"device_alias":row.device_alias,"device_model":row.device_model,"device_os":row.device_os,"device_os_version":row.device_os_version,"client_version":row.client_version,"client_protocol":row.client_protocol})).collect(),
        Err(error) => {
            tracing::warn!(%error, "Failed to read device presence metadata");
            return;
        }
    };
    let event = json!({"type":"device-presence","devices":devices});
    for socket in io.within(account_room(account)).sockets() {
        if socket.emit("ephemeral", &event).is_err() {
            let _ = socket.disconnect();
        }
    }
}
