//! Wire account-backed Pages tools to the account owner on the executing host.

use crate::agentic::tools::page_deploy_host::set_page_deploy_handler;
use crate::agentic::tools::page_publish_host::{
    set_page_account_availability, set_page_publish_handler, PageAccountAvailability,
    PagePublishHostRequest,
};
use crate::service::remote_connect::account_runtime::AccountRuntime;
use openbitfun_services_integrations::remote_connect::{
    deploy_page_version_on_relay, join_relay_url, list_pages_from_relay,
    publish_page_content_on_relay,
};
use serde_json::Value;
use std::sync::Arc;

/// Bind once when assembling the executing Runtime, never on a remote controller.
/// Weak references prevent the tool registry from extending the account lifetime.
pub fn register_account_pages(runtime: &Arc<AccountRuntime>) {
    set_page_account_availability(account_availability(runtime));
    let account = Arc::downgrade(runtime);
    set_page_publish_handler(Arc::new(move |request| {
        let account = account.upgrade();
        Box::pin(async move {
            let account = account.ok_or("Pages account runtime is unavailable")?;
            publish(&account, request).await
        })
    }));
    let account = Arc::downgrade(runtime);
    set_page_deploy_handler(Arc::new(move |slug, version_id| {
        let account = account.upgrade();
        Box::pin(async move {
            let account = account.ok_or("Pages account runtime is unavailable")?;
            deploy(&account, &slug, &version_id).await
        })
    }));
}

pub(crate) async fn publish(
    account: &AccountRuntime,
    request: PagePublishHostRequest,
) -> Result<Value, String> {
    if account.is_token_expired() {
        return Err("Pages account session expired; sign in again".into());
    }
    let generation = account.account_context_generation();
    let (session, relay_url) = account
        .read_account_context_for_generation(generation)
        .await
        .map_err(|error| error.to_string())?;
    let result = publish_page_content_on_relay(
        &relay_url,
        &session.token,
        &request.slug,
        &request.visibility,
        request.title.as_deref(),
        request.note.as_deref(),
        request.deploy,
        request.directory.as_deref(),
        request.files.as_ref(),
    )
    .await
    .map_err(|error| error.to_string())?;
    if !account.account_context_is_current(generation) {
        return Err("account context changed; publication outcome is unknown, inspect the original account before retrying".into());
    }
    serde_json::to_value(result).map_err(|error| error.to_string())
}

pub(crate) async fn deploy(
    account: &AccountRuntime,
    slug: &str,
    version_id: &str,
) -> Result<Value, String> {
    if account.is_token_expired() {
        return Err("Pages account session expired; sign in again".into());
    }
    let generation = account.account_context_generation();
    let (session, relay_url) = account
        .read_account_context_for_generation(generation)
        .await
        .map_err(|error| error.to_string())?;
    let page = list_pages_from_relay(&relay_url, &session.token)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|page| page.slug == slug)
        .ok_or("Page not found; refresh the Page list before deploying")?;
    if !account.account_context_is_current(generation) {
        return Err("account context changed".into());
    }
    let info = deploy_page_version_on_relay(
        &relay_url,
        &session.token,
        slug,
        version_id,
        &page.generation,
    )
    .await
    .map_err(|error| error.to_string())?;
    if !account.account_context_is_current(generation) {
        return Err("account context changed; deployment outcome is unknown, inspect the original account before retrying".into());
    }
    let url = join_relay_url(&relay_url, &info.url_path);
    let preview_url = info
        .preview_url_path
        .as_deref()
        .filter(|path| !path.is_empty())
        .map(|path| join_relay_url(&relay_url, path));
    let mut value = serde_json::to_value(info).map_err(|error| error.to_string())?;
    value["url"] = Value::String(url);
    if let Some(preview_url) = preview_url {
        value["preview_url"] = Value::String(preview_url);
    }
    Ok(value)
}

pub(crate) fn account_availability(runtime: &Arc<AccountRuntime>) -> PageAccountAvailability {
    let account = Arc::downgrade(runtime);
    Arc::new(move || {
        let account = account.upgrade();
        Box::pin(async move {
            match account {
                Some(account) => account.is_logged_in().await && !account.is_token_expired(),
                None => false,
            }
        })
    })
}
