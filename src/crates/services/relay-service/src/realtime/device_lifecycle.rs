//! Durable directory activation and revocation races; independent of wire framing.
use crate::relay::transport::ConnId;

async fn registered_device_token_is_current(
    db: &crate::db::DbPool,
    token: &str,
    expected_user_id: &str,
    expected_device_id: &str,
) -> anyhow::Result<bool> {
    Ok(crate::db::AuthToken::find(db, token)
        .await?
        .is_some_and(|current| {
            current.is_device_token()
                && current.user_id == expected_user_id
                && current.device_id == expected_device_id
        }))
}

async fn project_device_offline_if_unowned(
    db: &crate::db::DbPool,
    device_manager: &crate::relay::DeviceManager,
    user_id: &str,
    device_id: &str,
) -> anyhow::Result<()> {
    if !device_manager.is_device_online(user_id, device_id) {
        crate::db::DeviceRow::set_online(db, user_id, device_id, false).await?;
    }
    Ok(())
}

async fn reconcile_device_after_token_disconnect(
    db: &crate::db::DbPool,
    device_manager: &crate::relay::DeviceManager,
    user_id: &str,
    device_id: &str,
) -> anyhow::Result<()> {
    project_device_offline_if_unowned(db, device_manager, user_id, device_id).await
}

/// Complete the activation after the durable device projection has been
/// written. The caller must hold `presence_projection_gate`, keeping the
/// second token check, in-memory promotion, and any rollback atomic with
/// logout, device deletion, and socket cleanup.
async fn complete_pending_device_activation_if_authorized(
    db: &crate::db::DbPool,
    device_manager: &crate::relay::DeviceManager,
    token: &str,
    expected_user_id: &str,
    expected_device_id: &str,
    conn_id: ConnId,
) -> anyhow::Result<bool> {
    // The durable writes can wait on SQLite. Re-check wall-clock expiry
    // immediately before the synchronous promotion so a token that expired
    // during that wait never becomes routable or is announced as ready.
    let still_current =
        match registered_device_token_is_current(db, token, expected_user_id, expected_device_id)
            .await
        {
            Ok(current) => current,
            Err(error) => {
                device_manager.disconnect_pending(conn_id);
                let _ = project_device_offline_if_unowned(
                    db,
                    device_manager,
                    expected_user_id,
                    expected_device_id,
                )
                .await;
                return Err(error);
            }
        };
    if !still_current {
        device_manager.disconnect_device_if_token(expected_user_id, expected_device_id, token);
        reconcile_device_after_token_disconnect(
            db,
            device_manager,
            expected_user_id,
            expected_device_id,
        )
        .await?;
        return Ok(false);
    }

    // Pending remains invisible until every durable write succeeds. Promotion
    // is synchronous under the same lifecycle gate, so clients never route to
    // a socket whose namespace activation may still fail on database projection.
    if !device_manager.activate_pending(expected_user_id, expected_device_id, token, conn_id) {
        project_device_offline_if_unowned(db, device_manager, expected_user_id, expected_device_id)
            .await?;
        return Ok(false);
    }
    Ok(true)
}

pub(crate) async fn activate_pending_device_if_authorized(
    db: &crate::db::DbPool,
    device_manager: &crate::relay::DeviceManager,
    token: &str,
    expected_user_id: &str,
    expected_device_id: &str,
    device_name: &str,
    device_kind: Option<&str>,
    conn_id: ConnId,
) -> anyhow::Result<bool> {
    // Serialize the final token lookup, durable device update, activation, and
    // online projection with logout/delete/socket cleanup. No persistent side
    // effect occurs before this lookup, so a deleted device cannot be revived
    // by an namespace activation request that passed only the earlier lookup.
    let _presence_projection_guard = device_manager.lock_presence_projection().await;
    if !registered_device_token_is_current(db, token, expected_user_id, expected_device_id).await? {
        device_manager.disconnect_device_if_token(expected_user_id, expected_device_id, token);
        reconcile_device_after_token_disconnect(
            db,
            device_manager,
            expected_user_id,
            expected_device_id,
        )
        .await?;
        return Ok(false);
    }

    if let Err(error) = crate::db::DeviceRow::upsert(
        db,
        expected_device_id,
        expected_user_id,
        device_name,
        device_kind,
        None,
    )
    .await
    {
        device_manager.disconnect_pending(conn_id);
        return Err(error);
    }
    if let Err(error) =
        crate::db::DeviceRow::set_online(db, expected_user_id, expected_device_id, true).await
    {
        device_manager.disconnect_pending(conn_id);
        return Err(error);
    }
    complete_pending_device_activation_if_authorized(
        db,
        device_manager,
        token,
        expected_user_id,
        expected_device_id,
        conn_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{connect, AuthToken, DeviceRow, UserRow};
    use crate::relay::DeviceManager;
    use tokio::sync::{mpsc, watch};
    #[tokio::test]
    async fn token_revoked_between_initial_validation_and_activation_is_rejected() {
        let db = connect(":memory:").await.unwrap();
        UserRow::create(&db, "owner", "alice").await.unwrap();
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "device-a")
            .await
            .unwrap()
            .token;

        // This is the first namespace activation lookup. Pause the conceptual request
        // after it, then let logout delete the row before registration's
        // mandatory second lookup.
        assert!(AuthToken::find(&db, &token).await.unwrap().is_some());
        sqlx::query("DELETE FROM auth_tokens WHERE token = ?")
            .bind(&token)
            .execute(&db)
            .await
            .unwrap();

        let manager = DeviceManager::new();
        let (tx, _rx) = mpsc::channel(4);
        let (close_tx, mut close_rx) = watch::channel(false);
        manager.register_pending("owner", "device-a", &token, "Device A", 1, tx, close_tx);
        assert!(manager.online_devices("owner").is_empty());
        assert!(manager.conn_mapping(1).is_none());

        assert!(
            !registered_device_token_is_current(&db, &token, "owner", "device-a")
                .await
                .unwrap()
        );
        assert!(!activate_pending_device_if_authorized(
            &db, &manager, &token, "owner", "device-a", "Device A", None, 1,
        )
        .await
        .unwrap());
        close_rx.changed().await.unwrap();
        assert!(*close_rx.borrow());
        assert!(manager.conn_mapping(1).is_none());
    }

    #[tokio::test]
    async fn expired_token_disconnects_active_and_pending_without_ghost_online_projection() {
        let db = connect(":memory:").await.unwrap();
        UserRow::create(&db, "owner", "alice").await.unwrap();
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        DeviceRow::set_online(&db, "owner", "device-a", true)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "device-a")
            .await
            .unwrap()
            .token;

        let manager = DeviceManager::new();
        let (active_tx, _active_rx) = mpsc::channel(4);
        let (active_close_tx, mut active_close_rx) = watch::channel(false);
        manager.register(
            "owner",
            "device-a",
            &token,
            "Device A",
            1,
            active_tx,
            active_close_tx,
        );
        let (pending_tx, _pending_rx) = mpsc::channel(4);
        let (pending_close_tx, mut pending_close_rx) = watch::channel(false);
        manager.register_pending(
            "owner",
            "device-a",
            &token,
            "Device A",
            2,
            pending_tx,
            pending_close_tx,
        );
        let (peer_tx, _peer_rx) = mpsc::channel(4);
        let (peer_close_tx, _peer_close_rx) = watch::channel(false);
        manager.register(
            "owner",
            "device-c",
            "independent-token",
            "Device C",
            3,
            peer_tx,
            peer_close_tx,
        );

        sqlx::query("UPDATE auth_tokens SET expires_at = ? WHERE token = ?")
            .bind(chrono::Utc::now().timestamp())
            .bind(&token)
            .execute(&db)
            .await
            .unwrap();
        assert!(!activate_pending_device_if_authorized(
            &db, &manager, &token, "owner", "device-a", "Device A", None, 2,
        )
        .await
        .unwrap());

        active_close_rx.changed().await.unwrap();
        pending_close_rx.changed().await.unwrap();
        assert!(*active_close_rx.borrow());
        assert!(*pending_close_rx.borrow());
        assert!(manager.conn_mapping(1).is_none());
        assert!(manager.conn_mapping(2).is_none());
        assert_eq!(
            manager.conn_mapping(3),
            Some(("owner".into(), "device-c".into()))
        );
        assert!(!manager.route_message("owner", "device-a", "opaque"));
        let rows = DeviceRow::list_by_user(&db, "owner").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].online, 0);
    }

    #[tokio::test]
    async fn token_expiring_during_durable_projection_never_receives_auth_ok() {
        let db = connect(":memory:").await.unwrap();
        UserRow::create(&db, "owner", "alice").await.unwrap();
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "device-a")
            .await
            .unwrap()
            .token;
        let manager = DeviceManager::new();
        let (tx, mut rx) = mpsc::channel(4);
        let (close_tx, mut close_rx) = watch::channel(false);
        manager.register_pending("owner", "device-a", &token, "Device A", 1, tx, close_tx);

        let _projection_guard = manager.lock_presence_projection().await;
        assert!(
            registered_device_token_is_current(&db, &token, "owner", "device-a")
                .await
                .unwrap()
        );
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        DeviceRow::set_online(&db, "owner", "device-a", true)
            .await
            .unwrap();
        sqlx::query("UPDATE auth_tokens SET expires_at = ? WHERE token = ?")
            .bind(chrono::Utc::now().timestamp())
            .bind(&token)
            .execute(&db)
            .await
            .unwrap();

        assert!(!complete_pending_device_activation_if_authorized(
            &db, &manager, &token, "owner", "device-a", 1,
        )
        .await
        .unwrap());
        close_rx.changed().await.unwrap();
        assert!(*close_rx.borrow());
        assert!(
            rx.try_recv().is_err(),
            "expired activation must not emit control data"
        );
        assert!(manager.conn_mapping(1).is_none());
        let rows = DeviceRow::list_by_user(&db, "owner").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].online, 0);
    }

    #[tokio::test]
    async fn stale_auth_connect_cannot_recreate_a_deleted_device() {
        let db = connect(":memory:").await.unwrap();
        UserRow::create(&db, "owner", "alice").await.unwrap();
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "device-a")
            .await
            .unwrap()
            .token;
        assert!(AuthToken::find(&db, &token).await.unwrap().is_some());

        assert!(DeviceRow::delete_for_user(&db, "owner", "device-a")
            .await
            .unwrap());
        let manager = DeviceManager::new();
        let (tx, _rx) = mpsc::channel(4);
        let (close_tx, mut close_rx) = watch::channel(false);
        manager.register_pending("owner", "device-a", &token, "Device A", 1, tx, close_tx);

        assert!(!activate_pending_device_if_authorized(
            &db, &manager, &token, "owner", "device-a", "Device A", None, 1,
        )
        .await
        .unwrap());
        close_rx.changed().await.unwrap();
        assert!(*close_rx.borrow());
        assert!(DeviceRow::list_by_user(&db, "owner")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn pending_device_becomes_routable_only_after_durable_projection() {
        let db = connect(":memory:").await.unwrap();
        UserRow::create(&db, "owner", "alice").await.unwrap();
        DeviceRow::upsert(&db, "device-a", "owner", "Device A", None, None)
            .await
            .unwrap();
        let token = AuthToken::create(&db, "owner", "device-a")
            .await
            .unwrap()
            .token;
        let manager = DeviceManager::new();
        let (tx, mut rx) = mpsc::channel(4);
        let (close_tx, _close_rx) = watch::channel(false);
        manager.register_pending("owner", "device-a", &token, "Device A", 1, tx, close_tx);

        assert!(manager.online_devices("owner").is_empty());
        assert!(!manager.route_message("owner", "device-a", "opaque"));
        assert!(activate_pending_device_if_authorized(
            &db, &manager, &token, "owner", "device-a", "Device A", None, 1,
        )
        .await
        .unwrap());

        assert_eq!(
            manager.conn_mapping(1),
            Some(("owner".into(), "device-a".into()))
        );
        assert_eq!(manager.online_devices("owner").len(), 1);
        let rows = DeviceRow::list_by_user(&db, "owner").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].online, 1);

        assert!(
            rx.try_recv().is_err(),
            "directory activation must not enqueue a second wire protocol"
        );
    }
}
