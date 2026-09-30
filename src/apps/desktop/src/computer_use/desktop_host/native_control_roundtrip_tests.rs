//! Real Tool -> desktop host -> native capture/input regression, opt-in only.
use super::desktop_host::DesktopComputerUseHost;
use bitfun_core::agentic::tools::computer_use_host::ComputerUseHost;
use bitfun_core::agentic::tools::framework::{Tool, ToolUseContext};
use bitfun_core::agentic::tools::implementations::ComputerUseTool;
use serde_json::{json, Value};
use std::sync::Arc;

const OWNER: &str = "native-control-roundtrip-fixture";
struct StopOnExit;
impl Drop for StopOnExit {
    fn drop(&mut self) {
        let _ = crate::computer_use::control_session::stop(Some(OWNER), "fixture_cleanup");
    }
}

async fn call(tool: &ComputerUseTool, context: &ToolUseContext, input: Value) -> Value {
    let started = std::time::Instant::now();
    eprintln!("TRACE native roundtrip action: {}", input["action"]);
    let results = tool
        .call_impl(&input, context)
        .await
        .unwrap_or_else(|error| panic!("Tool action {} failed: {error}", input["action"]));
    eprintln!(
        "TRACE native roundtrip completed: {} elapsed_ms={}",
        input["action"],
        started.elapsed().as_millis()
    );
    let body = results
        .first()
        .expect("tool returned an observation")
        .content();
    assert_ne!(body.get("ok"), Some(&Value::Bool(false)), "{body}");
    assert_ne!(body.get("success"), Some(&Value::Bool(false)), "{body}");
    if body.get("ok") == Some(&Value::Bool(true)) && body.get("data").is_some() {
        body["data"].clone()
    } else {
        body
    }
}

fn assert_session(
    host: &DesktopComputerUseHost,
    generation: u64,
    target: &str,
    foreground: Option<i32>,
) {
    let current = host.control_snapshot();
    assert_eq!(current.state, "active", "{current:?}");
    assert_eq!(
        current.generation, generation,
        "control restarted between actions"
    );
    assert_eq!(
        current.target.as_deref(),
        Some(target),
        "capture retargeted between actions"
    );
    assert_eq!(crate::computer_use::macos_bg_input::frontmost_pid_macos(), foreground,
        "tool pipeline changed the foreground application; human switching also invalidates this assertion");
}

pub(crate) async fn run() {
    if std::env::var_os("BITFUN_INPUT_FIXTURE_PID").is_some() {
        run_covered_semantic().await;
        return;
    }
    let pid: i32 = std::env::var("BITFUN_ROUNDTRIP_FIXTURE_PID")
        .unwrap()
        .parse()
        .unwrap();
    let x: f64 = std::env::var("BITFUN_ROUNDTRIP_FIXTURE_X")
        .unwrap()
        .parse()
        .unwrap();
    let y: f64 = std::env::var("BITFUN_ROUNDTRIP_FIXTURE_Y")
        .unwrap()
        .parse()
        .unwrap();
    let result_path = std::env::var("BITFUN_ROUNDTRIP_FIXTURE_RESULT").unwrap();
    let foreground = crate::computer_use::macos_bg_input::frontmost_pid_macos();
    assert_ne!(
        foreground,
        Some(pid),
        "fixture must start in the background"
    );
    let host = Arc::new(DesktopComputerUseHost::new());
    let mut context = ToolUseContext::for_tool_listing(None, None);
    context.session_id = Some(OWNER.into());
    context.computer_use_host = Some(host.clone());
    context.primary_model_facts.supports_image_inputs = true;
    context.primary_model_facts.api_format = "anthropic".into();
    let tool = ComputerUseTool::new();
    let _cleanup = StopOnExit;
    let start = call(
        &tool,
        &context,
        json!({"action":"start_control", "mode":"background"}),
    )
    .await;
    let generation = start["generation"].as_u64().expect("control generation");
    let apps = call(&tool, &context, json!({"action":"list_apps"})).await;
    assert!(
        apps.to_string().contains(&pid.to_string()),
        "fixture missing from real application discovery"
    );
    let observation = call(
        &tool,
        &context,
        json!({"action":"get_app_state", "app":{"pid":pid}}),
    )
    .await;
    let target = host
        .control_snapshot()
        .target
        .expect("prepare_control_target bound a real window");
    assert_session(&host, generation, &target, foreground);
    let tree = observation["app_state"]["tree_text"]
        .as_str()
        .expect("AX observation");
    let button_line = tree
        .lines()
        .find(|line| line.contains("Fixture semantic action"))
        .expect("fixture button exposed through AX");
    let button_idx: u32 = button_line
        .trim()
        .strip_prefix('[')
        .unwrap()
        .split(']')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    call(
        &tool,
        &context,
        json!({"action":"app_click", "app":{"pid":pid},
        "target":{"kind":"node_idx", "idx":button_idx}}),
    )
    .await;
    assert_session(&host, generation, &target, foreground);

    // Refresh through the full tool after the sharing indicator has appeared.
    // The old implementation would switch to the indicator window here.
    let observation = call(
        &tool,
        &context,
        json!({"action":"get_app_state", "app":{"pid":pid}}),
    )
    .await;
    let meta = &observation["app_state"]["screenshot_meta"];
    let global = &meta["image_global_bounds"];
    let content = &meta["image_content_rect"];
    let image_x = content["left"].as_f64().unwrap()
        + (x - global["left"].as_f64().unwrap()) * content["width"].as_f64().unwrap()
            / global["width"].as_f64().unwrap();
    let image_y = content["top"].as_f64().unwrap()
        + (y - global["top"].as_f64().unwrap()) * content["height"].as_f64().unwrap()
            / global["height"].as_f64().unwrap();
    let batch = call(
        &tool,
        &context,
        json!({"action":"app_batch", "app":{"pid":pid}, "steps":[
            {"action":"app_click", "target":{"kind":"image_xy", "x":image_x.round() as i32, "y":image_y.round() as i32,
                  "screenshot_id":meta["screenshot_id"]}},
            {"action":"app_type_text", "text":"背景"},
            {"action":"app_type_text", "text":"输入"},
            {"action":"app_type_text", "text":" Test"},
            {"action":"app_key_chord", "keys":["return"]}
        ]}),
    )
    .await;
    assert_eq!(batch["completed_steps"], 5, "{batch}");
    assert_eq!(batch["status"], "submitted", "{batch}");
    assert_session(&host, generation, &target, foreground);

    // Exercise text-only observation/OCR against the same bound target.
    context.primary_model_facts.supports_image_inputs = false;
    let description = call(&tool, &context, json!({"action":"describe_screen"})).await;
    assert_eq!(description["target_application"]["pid"], pid);
    assert_eq!(
        description["ocr_status"], "ok",
        "native OCR must read the fixture: {description}"
    );
    assert!(
        description["ocr_text"].to_string().contains("Test"),
        "OCR must read the rendered input, independently of the AX value: {description}"
    );
    assert!(
        description.to_string().contains("背景输入 Test"),
        "final observation must expose the entered text"
    );
    assert_session(&host, generation, &target, foreground);
    let counts: Value =
        serde_json::from_str(&std::fs::read_to_string(result_path).unwrap()).unwrap();
    assert_eq!(
        counts,
        json!({"downs":1,"ups":1,"enters":1,"activations":1,"text":"背景输入 Test"}),
        "each mutation must reach the target exactly once"
    );
    let stop = call(&tool, &context, json!({"action":"stop_control"})).await;
    assert_eq!(stop["state"], "stopped");
    assert_eq!(
        host.control_snapshot().generation,
        generation + 1,
        "stop must revoke the active generation"
    );
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    eprintln!("PASS native tool pipeline: observation, semantic click, image click, Unicode input, Return, OCR verification and stop; binding/generation/foreground stayed stable");
}

async fn run_covered_semantic() {
    let pid: i32 = std::env::var("BITFUN_INPUT_FIXTURE_PID")
        .unwrap()
        .parse()
        .unwrap();
    let path = std::env::var("BITFUN_INPUT_FIXTURE_RESULT").unwrap();
    let observer_path = std::env::var("BITFUN_INPUT_OBSERVER_RESULT").unwrap();
    let read = |path: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let ready = std::fs::read_to_string(&observer_path)
            .ok()
            .and_then(|data| serde_json::from_str::<Value>(&data).ok());
        if ready.as_ref().is_some_and(|state| {
            state["ready"] == true
                && state["active"] == true
                && state["key_window"] == true
                && state["pid"].as_i64().map(|pid| pid as i32)
                    == crate::computer_use::macos_bg_input::frontmost_pid_macos()
        }) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "foreground observer failed to establish the startup baseline"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let initial = read(&path);
    let initial_observer = read(&observer_path);
    assert_eq!(initial["bundle_id"], "dev.bitfun.input-fixture.target");
    assert_eq!(
        initial_observer["bundle_id"],
        "dev.bitfun.input-fixture.observer"
    );
    let baseline_activations = initial_observer["activation_history"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(initial_observer["target_ahead"], false);
    let foreground = crate::computer_use::macos_bg_input::frontmost_pid_macos();
    assert_ne!(foreground, Some(pid));
    assert_eq!(initial["active"], false);
    let host = Arc::new(DesktopComputerUseHost::new());
    let mut context = ToolUseContext::for_tool_listing(None, None);
    context.session_id = Some(OWNER.into());
    context.computer_use_host = Some(host.clone());
    context.primary_model_facts.supports_image_inputs = true;
    context.primary_model_facts.api_format = "anthropic".into();
    let tool = ComputerUseTool::new();
    let _cleanup = StopOnExit;
    call(
        &tool,
        &context,
        json!({"action":"start_control","mode":"background"}),
    )
    .await;
    let observation = call(
        &tool,
        &context,
        json!({"action":"get_app_state","app":{"pid":pid}}),
    )
    .await;
    eprintln!(
        "After initial observation frontmost={:?} observer={}",
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        read(&observer_path)
    );
    // Reading an all-window AX snapshot is allowed, but input cannot escape
    // the captured window via a same-pid node or its coordinate fallback.
    {
        let mut lease = crate::computer_use::control_session::acquire(OWNER, "app_click").unwrap();
        let snapshot =
            crate::computer_use::macos_ax_dump::dump_app_ax(pid, Default::default()).unwrap();
        let foreign = snapshot
            .nodes
            .iter()
            .find(|node| node.title.as_deref() == Some("Unbound semantic action"))
            .expect("second-window control missing");
        let target =
            crate::computer_use::macos_ax_dump::retained_cached_target(pid, foreign.idx).unwrap();
        assert!(
            crate::computer_use::macos_ax_dump::validate_bound_target(pid, target.reference())
                .is_err()
        );
        assert!(matches!(
            crate::computer_use::macos_ax_write::try_ax_press(target.reference()),
            crate::computer_use::macos_ax_write::AxWriteOutcome::Unavailable(_)
        ));
        assert_eq!(read(&path)["foreign_actions"], 0);
        lease.complete();
        eprintln!("PASS same-process unbound AX window cannot receive semantic input or a pointer fallback");
    }
    let image_target = |observation: &Value, name: &str| {
        let meta = &observation["app_state"]["screenshot_meta"];
        let global = &meta["image_global_bounds"];
        let content = &meta["image_content_rect"];
        let p = &initial["targets"][name];
        let x = content["left"].as_f64().unwrap()
            + (p[0].as_f64().unwrap() - global["left"].as_f64().unwrap())
                * content["width"].as_f64().unwrap()
                / global["width"].as_f64().unwrap();
        let y = content["top"].as_f64().unwrap()
            + (p[1].as_f64().unwrap() - global["top"].as_f64().unwrap())
                * content["height"].as_f64().unwrap()
                / global["height"].as_f64().unwrap();
        json!({"kind":"image_xy","x":x.round() as i32,"y":y.round() as i32,"screenshot_id":meta["screenshot_id"]})
    };
    eprintln!(
        "Before image button: observer={} frontmost={:?}",
        read(&observer_path),
        crate::computer_use::macos_bg_input::frontmost_pid_macos()
    );
    let observation = call(&tool, &context, json!({"action":"app_click","app":{"pid":pid},"target":image_target(&observation,"button")})).await;
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let button_state = read(&path);
    let button_observer = read(&observer_path);
    eprintln!("After image button: target={button_state} observer={button_observer} frontmost={:?} expected={foreground:?}", crate::computer_use::macos_bg_input::frontmost_pid_macos());
    assert_eq!(button_state["button_actions"], 1);
    assert_eq!(
        button_state["events"].as_array().unwrap().len(),
        0,
        "image-coordinate button activation must use AXPress, not a raw mouse event"
    );
    assert_eq!(button_state["active"], false);
    assert_eq!(button_state["key_window"], false);
    assert_eq!(button_observer["active"], true);
    assert_eq!(button_observer["key_window"], true);
    assert_eq!(button_observer["target_ahead"], false);
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    eprintln!("PASS production ImageXy button activation exactly once without raw pointer events or raising the target");
    let field_target = image_target(&observation, "field");
    let result = call(
        &tool,
        &context,
        json!({"action":"app_batch","app":{"pid":pid},"steps":[
            {"action":"app_type_text","text":"native-control","focus":field_target},
            {"action":"app_type_text","text":"🙂中文","focus":field_target}
        ]}),
    )
    .await;
    assert_eq!(result["completed_steps"], 2, "{result}");
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let state = read(&path);
    let observer = read(&observer_path);
    eprintln!("TRACE production ImageXy semantic focus: target={state} observer={observer} frontmost={:?}", crate::computer_use::macos_bg_input::frontmost_pid_macos());
    assert_eq!(state["field_text"], "native-control🙂中文");
    assert_eq!(
        state["events"].as_array().unwrap().len(),
        0,
        "semantic focus must send zero pointer events"
    );
    assert_eq!(state["active"], false);
    assert_eq!(state["key_window"], false);
    assert_eq!(observer["active"], true);
    assert_eq!(observer["key_window"], true);
    assert_eq!(observer["target_ahead"], false);
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    let result = call(&tool, &context, json!({"action":"app_scroll","app":{"pid":pid},"dx":0,"dy":42,"focus":image_target(&result,"canvas")})).await;
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let scrolled = read(&path);
    let scroll_observer = read(&observer_path);
    eprintln!("TRACE targeted scroll: target={scrolled} observer={scroll_observer}");
    assert_eq!(
        scrolled["canvas_scrolls"], 1,
        "scroll must reach the canvas exactly once"
    );
    assert!(scrolled["canvas_scroll_y"].as_f64().unwrap().abs() > 0.0);
    assert_eq!(scrolled["canvas_downs"], 0);
    assert_eq!(scrolled["button_actions"], 1);
    assert_eq!(scrolled["events"].as_array().unwrap().len(), 0);
    assert_eq!(scrolled["active"], false);
    assert_eq!(scrolled["key_window"], false);
    assert_eq!(scroll_observer["active"], true);
    assert_eq!(scroll_observer["key_window"], true);
    assert_eq!(scroll_observer["target_ahead"], false);
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    eprintln!("PASS scroll anchor delivers canvas scrolling without a click or foreground change");
    // A canvas has no semantic text node. Explicit image focus must now use
    // the window-addressed input path, never type into the previous editor.
    let canvas_result = call(
        &tool,
        &context,
        json!({"action":"app_batch","app":{"pid":pid},"steps":[
            {"action":"app_click","target":image_target(&result,"canvas")},
            {"action":"app_type_text","text":"canvas"},
            {"action":"app_key_chord","keys":["command","shift","k"]},
            {"action":"app_scroll","dx":0,"dy":8,"focus":image_target(&result,"canvas")},
            {"action":"app_type_text","text":"🙂"}
        ]}),
    )
    .await;
    assert_eq!(canvas_result["completed_steps"], 5, "{canvas_result}");
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let state = read(&path);
    assert_eq!(state["field_text"], "native-control🙂中文");
    assert_eq!(state["canvas_text"], "canvas🙂");
    assert_eq!(state["shortcut_actions"], 1);
    assert_eq!(state["canvas_scrolls"], 2);
    assert_eq!(state["canvas_downs"], 1);
    assert_eq!(state["canvas_command_downs"], 0);
    assert_eq!(state["button_actions"], 1);
    let events = state["events"].as_array().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|e| e["hit"] == "OBFPlainCanvas" && e["type"] == 1)
            .count(),
        1
    );
    assert!(events
        .iter()
        .filter(|e| e["outside_frame"] == true)
        .all(|e| e["hit"] == "none" && e["flags"] == 0));
    let before_stop_observer = read(&observer_path);
    eprintln!(
        "TRACE after canvas batch: observer={before_stop_observer} foreground={:?}",
        crate::computer_use::macos_bg_input::frontmost_pid_macos()
    );
    assert_eq!(before_stop_observer["active"], true);
    assert_eq!(before_stop_observer["key_window"], true);
    assert_eq!(before_stop_observer["target_ahead"], false);
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    eprintln!(
        "PASS non-AX canvas receives one unmodified click and text without foreground change"
    );
    call(&tool, &context, json!({"action":"stop_control"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let final_observer = read(&observer_path);
    assert_eq!(
        read(&path)["active"],
        false,
        "Stop must clear target-local activation"
    );
    eprintln!(
        "TRACE after stop: observer={final_observer} target={} foreground={:?}",
        read(&path),
        crate::computer_use::macos_bg_input::frontmost_pid_macos()
    );
    assert_eq!(final_observer["active"], true);
    assert_eq!(final_observer["key_window"], true);
    assert_eq!(final_observer["target_ahead"], false);
    assert_eq!(
        crate::computer_use::macos_bg_input::frontmost_pid_macos(),
        foreground
    );
    assert!(
        final_observer["activation_history"]
            .as_array()
            .unwrap()
            .iter()
            .skip(baseline_activations)
            .all(|event| event["pid"].as_i64().map(|pid| pid as i32) == foreground),
        "foreground must not switch away and back between samples: {final_observer}"
    );
    eprintln!("PASS independent app bundles preserve foreground across all semantic actions and stop: {final_observer}");
}
