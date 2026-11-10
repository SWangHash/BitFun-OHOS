//! Desktop adapter for local speech input.
//!
//! On the `ohos` target the local sherpa-onnx recognizer is unsupported and
//! the HarmonyOS system `speechRecognizer` is used instead — it ships its own
//! on-device model, so BitFun does not download or manage any speech model on
//! HarmonyOS. To keep the ohos build artifact free of the local model path
//! entirely, every command is compiled as one of two mutually exclusive
//! versions via `#[cfg(target_env = "ohos")]`:
//!
//! - ohos version: the four input-session commands route through
//!   [`ohos_speech_call`] to the ArkTS-registered `ohos_speech_*` bridge
//!   functions (see
//!   `src/apps/ohos/entry/src/main/ets/services/VoiceInputService.ets`);
//!   `list_models` reports a single installed system-recognizer stub so the
//!   existing frontend gating passes; download/delete/verify reject.
//! - non-ohos version: unchanged — drives `state.speech_service` (sherpa-onnx).
//!
//! Realtime voice calling resolves a different provider per platform. Desktop
//! connects to the hosted Volcengine realtime session; HarmonyOS drives the
//! system `speechRecognizer` + `textToSpeech` through the ArkTS bridge
//! (`RealtimeVoiceService.ets`) and reports the same `speech://realtime-event`
//! payloads, so the web-ui controller keeps one contract.

use crate::api::AppState;
#[cfg(target_env = "ohos")]
use bitfun_core::util::ohos_speech_call;
#[cfg(target_env = "ohos")]
use bitfun_core_types::speech::SpeechModelInstallState;
use bitfun_core_types::speech::{
    SpeechAppendAudioChunkRequest, SpeechAppendAudioChunkResponse,
    SpeechAppendRealtimeAudioRequest, SpeechCancelInputSessionRequest,
    SpeechCancelModelDownloadRequest, SpeechDeleteModelRequest, SpeechDownloadModelRequest,
    SpeechFinishInputSessionRequest, SpeechGetRealtimeConfigRequest, SpeechInputSession,
    SpeechListModelsResponse, SpeechModelStatus, SpeechRealtimeConfig, SpeechRealtimeSession,
    SpeechRealtimeSessionRequest, SpeechRealtimeSpeakRequest, SpeechRealtimeToolResultRequest,
    SpeechSaveRealtimeConfigRequest, SpeechStartInputSessionRequest,
    SpeechStartRealtimeSessionRequest, SpeechTranscriptionResult, SpeechVerifyModelRequest,
};
#[cfg(not(target_env = "ohos"))]
use bitfun_core_types::speech::{SpeechModelProgressEvent, SpeechRealtimeEvent};
#[cfg(not(target_env = "ohos"))]
use bitfun_events::SPEECH_REALTIME_EVENT;
#[cfg(not(target_env = "ohos"))]
use bitfun_events::{SPEECH_MODEL_PROGRESS_EVENT, SPEECH_MODEL_STATUS_CHANGED_EVENT};
#[cfg(not(target_env = "ohos"))]
use bitfun_services_integrations::speech::VolcengineRealtimeSpeechConfig;
use tauri::State;
#[cfg(not(target_env = "ohos"))]
use tauri::{AppHandle, Emitter};

/// Provider id the web-ui uses to select the HarmonyOS system voice paths.
/// It matches the synthetic system-recognizer model status reported on OHOS.
#[cfg(target_env = "ohos")]
const OHOS_REALTIME_PROVIDER: &str = "ohos-system";

/// Whether the HarmonyOS realtime call is available.
///
/// The system voice needs no hosted credential, so a fresh profile is callable
/// without visiting settings first. A profile that was never saved still carries
/// the shared default provider (`volcengine`), which is how a fresh install is
/// recognized: only a saved `ohos-system` profile with `enabled = false` turns
/// the entry point off.
#[cfg(target_env = "ohos")]
fn ohos_realtime_enabled(config: &bitfun_core::service::config::VoiceCallConfig) -> bool {
    if config.provider != OHOS_REALTIME_PROVIDER {
        return true;
    }
    config.enabled
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_list_models() -> Result<SpeechListModelsResponse, String> {
    Ok(SpeechListModelsResponse {
        models: vec![ohos_system_model_status()],
    })
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_list_models(
    state: State<'_, AppState>,
) -> Result<SpeechListModelsResponse, String> {
    state
        .speech_service
        .list_models()
        .await
        .map_err(|error| format!("Failed to list speech models: {error}"))
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_download_model(
    request: SpeechDownloadModelRequest,
) -> Result<SpeechModelStatus, String> {
    Err(format!(
        "Speech model download is not supported on HarmonyOS; the system speechRecognizer ships its own on-device model (model_id={}).",
        request.model_id
    ))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_download_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechDownloadModelRequest,
) -> Result<SpeechModelStatus, String> {
    let progress_app = app.clone();
    let status = state
        .speech_service
        .download_model(request, move |event: SpeechModelProgressEvent| {
            if let Err(error) = progress_app.emit(SPEECH_MODEL_PROGRESS_EVENT, &event) {
                log::warn!("Failed to emit speech model progress event: {error}");
            }
        })
        .await
        .map_err(|error| format!("Failed to download speech model: {error}"))?;
    emit_status(&app, &status);
    Ok(status)
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_cancel_model_download(
    request: SpeechCancelModelDownloadRequest,
) -> Result<SpeechModelStatus, String> {
    Err(format!(
        "Speech model download is not supported on HarmonyOS; nothing to cancel (model_id={}).",
        request.model_id
    ))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_cancel_model_download(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechCancelModelDownloadRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .cancel_model_download(request)
        .await
        .map_err(|error| format!("Failed to cancel speech model download: {error}"))?;
    emit_status(&app, &status);
    Ok(status)
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_delete_model(
    request: SpeechDeleteModelRequest,
) -> Result<SpeechModelStatus, String> {
    Err(format!(
        "Speech model management is not supported on HarmonyOS; the system speechRecognizer ships its own on-device model (model_id={}).",
        request.model_id
    ))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_delete_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechDeleteModelRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .delete_model(request)
        .await
        .map_err(|error| format!("Failed to delete speech model: {error}"))?;
    emit_status(&app, &status);
    Ok(status)
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_verify_model(
    request: SpeechVerifyModelRequest,
) -> Result<SpeechModelStatus, String> {
    Err(format!(
        "Speech model verification is not supported on HarmonyOS; the system speechRecognizer ships its own on-device model (model_id={}).",
        request.model_id
    ))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_verify_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechVerifyModelRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .verify_model(request)
        .await
        .map_err(|error| format!("Failed to verify speech model: {error}"))?;
    emit_status(&app, &status);
    Ok(status)
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_start_input_session(
    request: SpeechStartInputSessionRequest,
) -> Result<SpeechInputSession, String> {
    log::info!(
        "[speech] start_input_session ohos branch, request={:?}",
        request
    );
    let payload = serde_json::to_string(&request).map_err(|error| {
        log::error!("[speech] failed to encode start request: {}", error);
        format!("Failed to encode speech start request: {error}")
    })?;
    let response = match ohos_speech_call("ohos_speech_start", &payload).await {
        Ok(r) => r,
        Err(e) => {
            log::error!("[speech] ohos_speech_start returned error: {}", e);
            return Err(format!("Failed to start speech input session: {e}"));
        }
    };
    log::info!("[speech] ohos_speech_start response: {}", response);
    let value: serde_json::Value = serde_json::from_str(&response).map_err(|error| {
        log::error!(
            "[speech] failed to parse start response json: {} | response={}",
            error,
            response
        );
        format!("Invalid speech start response from ArkTS: {error}: {response}")
    })?;
    if let Some(err_msg) = value.get("__error").and_then(|v| v.as_str()) {
        log::error!("[speech] ArkTS speech start failed: {}", err_msg);
        return Err(format!("ArkTS speech start failed: {err_msg}"));
    }
    serde_json::from_value::<SpeechInputSession>(value).map_err(|error| {
        log::error!("[speech] failed to parse start session: {}", error);
        format!("Invalid speech start session from ArkTS: {error}")
    })
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_start_input_session(
    state: State<'_, AppState>,
    request: SpeechStartInputSessionRequest,
) -> Result<SpeechInputSession, String> {
    state
        .speech_service
        .start_input_session(request)
        .await
        .map_err(|error| format!("Failed to start speech input session: {error}"))
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_append_audio_chunk(
    request: SpeechAppendAudioChunkRequest,
) -> Result<SpeechAppendAudioChunkResponse, String> {
    let payload = serde_json::to_string(&request)
        .map_err(|error| format!("Failed to encode speech append request: {error}"))?;
    let response = ohos_speech_call("ohos_speech_append", &payload).await?;
    serde_json::from_str(&response)
        .map_err(|error| format!("Invalid speech append response from ArkTS: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_append_audio_chunk(
    state: State<'_, AppState>,
    request: SpeechAppendAudioChunkRequest,
) -> Result<SpeechAppendAudioChunkResponse, String> {
    state
        .speech_service
        .append_audio_chunk(request)
        .await
        .map_err(|error| format!("Failed to append speech audio chunk: {error}"))
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_finish_input_session(
    request: SpeechFinishInputSessionRequest,
) -> Result<SpeechTranscriptionResult, String> {
    let payload = serde_json::to_string(&request)
        .map_err(|error| format!("Failed to encode speech finish request: {error}"))?;
    let response = ohos_speech_call("ohos_speech_finish", &payload).await?;
    serde_json::from_str(&response)
        .map_err(|error| format!("Invalid speech finish response from ArkTS: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_finish_input_session(
    state: State<'_, AppState>,
    request: SpeechFinishInputSessionRequest,
) -> Result<SpeechTranscriptionResult, String> {
    state
        .speech_service
        .finish_input_session(request)
        .await
        .map_err(|error| format!("Failed to transcribe speech input: {error}"))
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_cancel_input_session(
    request: SpeechCancelInputSessionRequest,
) -> Result<(), String> {
    let payload = serde_json::to_string(&request)
        .map_err(|error| format!("Failed to encode speech cancel request: {error}"))?;
    let _ = ohos_speech_call("ohos_speech_cancel", &payload).await?;
    Ok(())
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_cancel_input_session(
    state: State<'_, AppState>,
    request: SpeechCancelInputSessionRequest,
) -> Result<(), String> {
    state
        .speech_service
        .cancel_input_session(request)
        .await
        .map_err(|error| format!("Failed to cancel speech input session: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_start_realtime_session(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechStartRealtimeSessionRequest,
) -> Result<SpeechRealtimeSession, String> {
    let global_config: bitfun_core::service::config::GlobalConfig = state
        .config_service
        .get_config(None)
        .await
        .map_err(|error| format!("Failed to load realtime voice configuration: {error}"))?;
    let voice_call = global_config.app.voice_call;
    if !voice_call.enabled {
        return Err("Realtime voice calling is disabled in settings".to_string());
    }
    if voice_call.provider != "volcengine" {
        return Err(format!(
            "Unsupported realtime voice provider: {}",
            voice_call.provider
        ));
    }

    let event_app = app.clone();
    state
        .speech_service
        .start_realtime_session(
            VolcengineRealtimeSpeechConfig {
                api_key: voice_call.api_key,
                voice: voice_call.voice,
                speed: voice_call.speed,
                loudness: voice_call.loudness,
                client_context: request.client_context,
            },
            move |event: SpeechRealtimeEvent| {
                if let Err(error) = event_app.emit(SPEECH_REALTIME_EVENT, &event) {
                    log::warn!("Failed to emit realtime speech event: {error}");
                }
            },
        )
        .await
        .map_err(|error| format!("Failed to start realtime speech session: {error}"))
}

/// Starts the HarmonyOS client-side realtime voice call.
///
/// The ArkTS `RealtimeVoiceService` owns microphone capture, recognition, and
/// synthesis. No hosted-provider credential is read or forwarded: the call runs
/// entirely on the device, so only the persisted `enabled` switch gates it.
#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_start_realtime_session(
    state: State<'_, AppState>,
    request: SpeechStartRealtimeSessionRequest,
) -> Result<SpeechRealtimeSession, String> {
    let global_config: bitfun_core::service::config::GlobalConfig = state
        .config_service
        .get_config(None)
        .await
        .map_err(|error| format!("Failed to load realtime voice configuration: {error}"))?;
    let voice_call = global_config.app.voice_call;
    if !ohos_realtime_enabled(&voice_call) {
        return Err("Realtime voice calling is disabled in settings".to_string());
    }

    let payload = serde_json::json!({ "language": request.language });
    let response = ohos_speech_call("ohos_realtime_start", &payload.to_string())
        .await
        .map_err(|error| format!("Failed to start realtime voice call: {error}"))?;
    let session_id = serde_json::from_str::<serde_json::Value>(&response)
        .ok()
        .and_then(|value| {
            value
                .get("sessionId")
                .and_then(|session| session.as_str())
                .map(str::to_string)
        })
        .filter(|session| !session.is_empty())
        .ok_or_else(|| "HarmonyOS realtime voice did not report a session id".to_string())?;

    Ok(SpeechRealtimeSession {
        session_id,
        input_sample_rate: 16_000,
        output_sample_rate: 24_000,
    })
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_append_realtime_audio(
    state: State<'_, AppState>,
    request: SpeechAppendRealtimeAudioRequest,
) -> Result<(), String> {
    state
        .speech_service
        .append_realtime_audio(request)
        .await
        .map_err(|error| format!("Failed to append realtime speech audio: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_commit_realtime_audio(
    state: State<'_, AppState>,
    request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    state
        .speech_service
        .commit_realtime_audio(request)
        .await
        .map_err(|error| format!("Failed to commit realtime speech audio: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_send_realtime_tool_result(
    state: State<'_, AppState>,
    request: SpeechRealtimeToolResultRequest,
) -> Result<(), String> {
    state
        .speech_service
        .send_realtime_tool_result(request)
        .await
        .map_err(|error| format!("Failed to send realtime speech tool result: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_speak_realtime_text(
    state: State<'_, AppState>,
    request: SpeechRealtimeSpeakRequest,
) -> Result<(), String> {
    state
        .speech_service
        .speak_realtime_text(request)
        .await
        .map_err(|error| format!("Failed to speak realtime progress: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_cancel_realtime_response(
    state: State<'_, AppState>,
    request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    state
        .speech_service
        .cancel_realtime_response(request)
        .await
        .map_err(|error| format!("Failed to cancel realtime speech response: {error}"))
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_close_realtime_session(
    state: State<'_, AppState>,
    request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    state
        .speech_service
        .close_realtime_session(request)
        .await
        .map_err(|error| format!("Failed to close realtime speech session: {error}"))
}

// HarmonyOS keeps audio inside the device: the ArkTS service captures and
// recognizes on its own, so the frontend never uploads PCM and there is no
// provider round trip to answer with a tool result.

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_append_realtime_audio(
    _request: SpeechAppendRealtimeAudioRequest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_commit_realtime_audio(
    _request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_send_realtime_tool_result(
    _request: SpeechRealtimeToolResultRequest,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_speak_realtime_text(request: SpeechRealtimeSpeakRequest) -> Result<(), String> {
    let payload = serde_json::json!({ "text": request.text });
    ohos_speech_call("ohos_realtime_speak", &payload.to_string())
        .await
        .map_err(|error| format!("Failed to speak realtime text: {error}"))?;
    Ok(())
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_cancel_realtime_response(
    _request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    ohos_speech_call("ohos_realtime_stop_speech", "")
        .await
        .map_err(|error| format!("Failed to stop realtime speech playback: {error}"))?;
    Ok(())
}

#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_close_realtime_session(
    _request: SpeechRealtimeSessionRequest,
) -> Result<(), String> {
    ohos_speech_call("ohos_realtime_stop", "")
        .await
        .map_err(|error| format!("Failed to close realtime voice call: {error}"))?;
    Ok(())
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_get_realtime_config(
    state: State<'_, AppState>,
    request: SpeechGetRealtimeConfigRequest,
) -> Result<SpeechRealtimeConfig, String> {
    let _ = request;
    let global_config: bitfun_core::service::config::GlobalConfig = state
        .config_service
        .get_config(None)
        .await
        .map_err(|error| format!("Failed to load controller realtime voice settings: {error}"))?;
    let config = global_config.app.voice_call;
    Ok(SpeechRealtimeConfig {
        enabled: config.enabled,
        provider: config.provider,
        api_key: config.api_key,
        voice: config.voice,
        speed: config.speed,
        loudness: config.loudness,
        microphone_device_id: config.microphone_device_id,
    })
}

#[cfg(not(target_env = "ohos"))]
#[tauri::command]
pub async fn speech_save_realtime_config(
    state: State<'_, AppState>,
    request: SpeechSaveRealtimeConfigRequest,
) -> Result<SpeechRealtimeConfig, String> {
    let api_key = request.api_key.trim().to_string();
    let voice = request.voice.trim().to_string();
    if request.enabled && api_key.is_empty() {
        return Err(
            "Volcengine realtime speech API key is required when voice calling is enabled"
                .to_string(),
        );
    }
    if voice.is_empty() {
        return Err("Volcengine realtime speech voice cannot be empty".to_string());
    }
    if !(-50..=100).contains(&request.speed) || !(-50..=100).contains(&request.loudness) {
        return Err("Realtime speech speed and loudness must be between -50 and 100".to_string());
    }
    let config = bitfun_core::service::config::VoiceCallConfig {
        enabled: request.enabled,
        provider: "volcengine".to_string(),
        api_key,
        voice,
        speed: request.speed,
        loudness: request.loudness,
        microphone_device_id: request.microphone_device_id,
    };
    state
        .config_service
        .set_config("app.voice_call", &config)
        .await
        .map_err(|error| format!("Failed to save controller realtime voice settings: {error}"))?;

    Ok(SpeechRealtimeConfig {
        enabled: config.enabled,
        provider: config.provider,
        api_key: config.api_key,
        voice: config.voice,
        speed: config.speed,
        loudness: config.loudness,
        microphone_device_id: config.microphone_device_id,
    })
}

/// HarmonyOS reports the system voice profile: no hosted-provider credential is
/// part of the call, so `provider` is normalized and the key is never read.
#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_get_realtime_config(
    state: State<'_, AppState>,
    _request: SpeechGetRealtimeConfigRequest,
) -> Result<SpeechRealtimeConfig, String> {
    let global_config: bitfun_core::service::config::GlobalConfig = state
        .config_service
        .get_config(None)
        .await
        .map_err(|error| format!("Failed to load realtime voice settings: {error}"))?;
    let config = global_config.app.voice_call;
    Ok(SpeechRealtimeConfig {
        enabled: ohos_realtime_enabled(&config),
        provider: OHOS_REALTIME_PROVIDER.to_string(),
        api_key: String::new(),
        voice: config.voice,
        speed: config.speed,
        loudness: config.loudness,
        microphone_device_id: config.microphone_device_id,
    })
}

/// Enabling the HarmonyOS call needs no API key: recognition and synthesis are
/// system capabilities. Provider-only fields are written empty so a later
/// desktop profile cannot inherit a stale credential from this platform.
#[cfg(target_env = "ohos")]
#[tauri::command]
pub async fn speech_save_realtime_config(
    state: State<'_, AppState>,
    request: SpeechSaveRealtimeConfigRequest,
) -> Result<SpeechRealtimeConfig, String> {
    if !(-50..=100).contains(&request.speed) || !(-50..=100).contains(&request.loudness) {
        return Err("Realtime speech speed and loudness must be between -50 and 100".to_string());
    }
    let config = bitfun_core::service::config::VoiceCallConfig {
        enabled: request.enabled,
        provider: OHOS_REALTIME_PROVIDER.to_string(),
        api_key: String::new(),
        voice: String::new(),
        speed: request.speed,
        loudness: request.loudness,
        microphone_device_id: request.microphone_device_id,
    };
    state
        .config_service
        .set_config("app.voice_call", &config)
        .await
        .map_err(|error| format!("Failed to save realtime voice settings: {error}"))?;

    Ok(SpeechRealtimeConfig {
        enabled: config.enabled,
        provider: config.provider,
        api_key: config.api_key,
        voice: config.voice,
        speed: config.speed,
        loudness: config.loudness,
        microphone_device_id: config.microphone_device_id,
    })
}

#[cfg(not(target_env = "ohos"))]
fn emit_status(app: &AppHandle, status: &SpeechModelStatus) {
    if let Err(error) = app.emit(SPEECH_MODEL_STATUS_CHANGED_EVENT, status) {
        log::warn!("Failed to emit speech model status event: {error}");
    }
}

/// Synthetic `Installed` model status returned by `speech_list_models` on the
/// `ohos` target.
///
/// The frontend (`useComposerVoiceInput`) gates recording on
/// `modelInstalled === true` for the configured local model id. On HarmonyOS
/// there is no downloadable model — the system `speechRecognizer` ships its
/// own — so we report the default local model id (`sensevoice-small-int8`) as
/// installed to keep the existing frontend gating logic passing without any
/// frontend change. Downloads/deletes/verifies are rejected by the other
/// ohos commands, so no model file is ever touched.
#[cfg(target_env = "ohos")]
fn ohos_system_model_status() -> SpeechModelStatus {
    SpeechModelStatus {
        model_id: "sensevoice-small-int8".to_string(),
        display_name: "HarmonyOS System Speech Recognition".to_string(),
        provider: "ohos-system".to_string(),
        version: "1".to_string(),
        description:
            "On-device speech recognition provided by the HarmonyOS system speechRecognizer."
                .to_string(),
        languages: vec!["zh-CN".to_string(), "en-US".to_string()],
        state: SpeechModelInstallState::Installed,
        installed_path: None,
        installed_bytes: 0,
        expected_bytes: 0,
        progress: None,
        error: None,
    }
}
