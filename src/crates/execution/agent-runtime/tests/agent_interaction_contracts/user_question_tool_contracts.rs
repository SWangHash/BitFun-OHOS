use bitfun_agent_runtime::user_questions::{
    ask_user_question_available_for_acp_transport, ask_user_question_available_in_context,
    build_answered_user_question_result, build_cancelled_user_question_result,
    validate_ask_user_question_input, AskUserQuestionInput, Question, QuestionOption,
    QuestionPresentation,
};
use bitfun_product_domains::qt_migration::{QtMigrationOption, QtMigrationQuestion};

fn question() -> Question {
    Question {
        question: "Which path should be used?".to_string(),
        header: "Path".to_string(),
        options: vec![
            QuestionOption {
                label: "A".to_string(),
                description: "Use A".to_string(),
                value: None,
            },
            QuestionOption {
                label: "B".to_string(),
                description: "Use B".to_string(),
                value: None,
            },
        ],
        multi_select: false,
        input_placeholder: None,
        field: None,
        required: false,
    }
}

#[test]
fn ask_user_question_validation_preserves_legacy_limits() {
    assert_eq!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: vec![],
                template_id: None,
                timeout_seconds: 30,
            },
            false
        )
        .expect_err("empty questions should fail"),
        "At least one question is required"
    );

    let mut too_many = vec![question(), question(), question(), question(), question()];
    assert_eq!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: std::mem::take(&mut too_many),
                template_id: None,
                timeout_seconds: 30,
            },
            false
        )
        .expect_err("too many questions should fail"),
        "Maximum 4 questions allowed"
    );

    let mut missing_header = question();
    missing_header.header.clear();
    assert_eq!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: vec![missing_header],
                template_id: None,
                timeout_seconds: 30,
            },
            false
        )
        .expect_err("missing header should fail"),
        "Question 1 header is required"
    );
}

#[test]
fn ask_user_question_available_flag_matches_acp_transport_contract() {
    assert!(!ask_user_question_available_for_acp_transport(Some(
        &serde_json::json!(true)
    )));
    assert!(!ask_user_question_available_for_acp_transport(Some(
        &serde_json::json!("true")
    )));
    assert!(ask_user_question_available_for_acp_transport(Some(
        &serde_json::json!(false)
    )));
    assert!(ask_user_question_available_for_acp_transport(None));
}

#[test]
fn ask_user_question_availability_honors_non_interactive_surface_fact() {
    assert!(!ask_user_question_available_in_context(
        None,
        Some(&serde_json::json!(false)),
    ));
    assert!(!ask_user_question_available_in_context(
        None,
        Some(&serde_json::json!("false")),
    ));
    assert!(ask_user_question_available_in_context(
        None,
        Some(&serde_json::json!(true)),
    ));
    assert!(!ask_user_question_available_in_context(
        Some(&serde_json::json!(true)),
        Some(&serde_json::json!(true)),
    ));
}

#[test]
fn ask_user_question_answered_and_cancelled_results_keep_wire_shape() {
    let input = AskUserQuestionInput {
        questions: vec![question()],
        template_id: None,
        timeout_seconds: 30,
    };
    let answered = build_answered_user_question_result(
        &input,
        serde_json::json!({
            "0": "A"
        }),
    );

    assert_eq!(answered.data["status"], "answered");
    assert_eq!(
        answered.data["questions"][0]["question"],
        input.questions[0].question
    );
    assert_eq!(
        answered.data["questions"][0]["header"],
        input.questions[0].header
    );
    assert_eq!(answered.data["answers"]["0"], "A");
    assert!(answered
        .result_for_assistant
        .contains("- Which path should be used? (Path): \"A\""));

    let cancelled = build_cancelled_user_question_result(&input);
    assert_eq!(cancelled.data["status"], "cancelled");
    assert_eq!(cancelled.data["questions_count"], 1);
    assert_eq!(
        cancelled.result_for_assistant,
        "User input request was cancelled."
    );
}

#[test]
fn ask_user_question_input_defaults_multi_select_to_false_when_omitted() {
    let input: AskUserQuestionInput = serde_json::from_value(serde_json::json!({
        "questions": [{
            "question": "Which path should be used?",
            "header": "Path",
            "options": [
                { "label": "A", "description": "Use A" },
                { "label": "B", "description": "Use B" }
            ]
        }]
    }))
    .expect("input without multiSelect should deserialize");

    assert!(!input.questions[0].multi_select);
}

#[test]
fn ask_user_question_input_preserves_input_placeholder_round_trip() {
    let input: AskUserQuestionInput = serde_json::from_value(serde_json::json!({
        "questions": [{
            "question": "Source project?",
            "header": "Source",
            "options": [
                { "label": "Default", "description": "Default path" },
                { "label": "Alt", "description": "Alternate path" }
            ],
            "inputPlaceholder": "Please fill in the source project path"
        }]
    }))
    .expect("input with inputPlaceholder should deserialize");

    assert_eq!(
        input.questions[0].input_placeholder.as_deref(),
        Some("Please fill in the source project path")
    );

    let encoded = serde_json::to_value(&input).expect("input should serialize");
    assert_eq!(
        encoded["questions"][0]["inputPlaceholder"],
        "Please fill in the source project path"
    );
}

#[test]
fn ask_user_question_validation_rejects_empty_input_placeholder() {
    let mut question = question();
    question.input_placeholder = Some("   ".to_string());
    assert_eq!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: vec![question],
                template_id: None,
                timeout_seconds: 30,
            },
            false
        )
        .expect_err("empty inputPlaceholder should fail"),
        "Question 1 inputPlaceholder must not be empty"
    );
}

#[test]
fn ask_user_question_validation_allows_single_option_only_for_template_questions() {
    let mut single = question();
    single.options = vec![QuestionOption {
        label: "默认路径".to_string(),
        description: "D:/work/myqt".to_string(),
        value: None,
    }];
    single.input_placeholder = Some("请填写原始工程路径".to_string());

    // Template-resolved questions may carry exactly one candidate option.
    assert!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: vec![single.clone()],
                template_id: Some("qt-migration-paths".to_string()),
                timeout_seconds: 30,
            },
            true
        )
        .is_ok(),
        "single candidate option must pass in template mode"
    );
    // Model-written questions keep the strict 2-10 rule.
    assert_eq!(
        validate_ask_user_question_input(
            &AskUserQuestionInput {
                questions: vec![single],
                template_id: None,
                timeout_seconds: 30,
            },
            false
        )
        .expect_err("single option must fail for model-written questions"),
        "Question 1 must have 2-10 options"
    );
}

#[test]
fn ask_user_question_template_id_round_trips_and_takes_precedence() {
    // templateId deserializes from the wire shape and serializes back.
    let input: AskUserQuestionInput = serde_json::from_value(serde_json::json!({
        "templateId": "qt-migration-paths",
        "questions": []
    }))
    .expect("templateId input should deserialize");
    assert_eq!(input.template_id.as_deref(), Some("qt-migration-paths"));
    assert!(input.questions.is_empty());

    let encoded = serde_json::to_value(&input).expect("input should serialize");
    assert_eq!(encoded["templateId"], "qt-migration-paths");

    // Omitting templateId keeps the previous shape (no templateId key emitted).
    let plain = AskUserQuestionInput {
        questions: vec![question()],
        template_id: None,
        timeout_seconds: 30,
    };
    let encoded_plain = serde_json::to_value(&plain).expect("input should serialize");
    assert!(encoded_plain.get("templateId").is_none());
}

#[test]
fn ask_user_question_validation_accepts_template_backed_questions() {
    // Template content is pinned by the domain crate's contract test; here the
    // tool-side contract is that template-shaped questions pass the shared
    // validation with template-backed leniency.
    let questions: Vec<Question> = ["source_project", "output_project", "toolchain", "template"]
        .iter()
        .map(|field| Question {
            question: format!("Where is the {field}?"),
            header: "Path".to_string(),
            options: Vec::new(),
            multi_select: false,
            input_placeholder: Some("/path/to/dir".to_string()),
            field: Some((*field).to_string()),
            required: true,
        })
        .collect();
    assert!(validate_ask_user_question_input(
        &AskUserQuestionInput {
            questions,
            template_id: Some("qt-migration-paths".to_string()),
            timeout_seconds: 30,
        },
        true
    )
    .is_ok());
}

#[test]
fn template_resolved_payload_keeps_params_immutable_and_carries_policy() {
    use bitfun_agent_runtime::user_questions::ResolvedQuestionRequest;

    // The shapes the qt-migration-paths template produces; content is pinned
    // by the domain crate's contract test.
    let fields = ["source_project", "output_project", "toolchain", "template"];
    let resolved_questions: Vec<Question> = fields
        .iter()
        .map(|field| Question {
            question: format!("Where is the {field}?"),
            header: "Path".to_string(),
            options: Vec::new(),
            multi_select: false,
            input_placeholder: Some("/path/to/dir".to_string()),
            field: Some((*field).to_string()),
            required: true,
        })
        .collect();
    let presentation = QuestionPresentation {
        layout: "wizard".to_string(),
        allow_skip: false,
        intro_key: None,
        hint_key: None,
        required_fields: Some(fields.iter().map(|f| f.to_string()).collect()),
        allow_timeout: false,
    };
    let qt_migration_questions: Vec<QtMigrationQuestion> = fields
        .iter()
        .map(|field| QtMigrationQuestion {
            field: (*field).to_string(),
            header: format!("askUser.qtMigration.field.{field}"),
            prompt: format!("askUser.qtMigration.question.{field}"),
            placeholder: None,
            required: true,
            options: vec![QtMigrationOption {
                label: "Official toolchain".to_string(),
                description: None,
                path: String::new(),
                value: Some("__official__".to_string()),
                version: None,
            }],
        })
        .collect();
    // The payload rides the envelope as opaque JSON; the host never interprets it.
    let template_payload =
        serde_json::to_value(&qt_migration_questions).expect("template payload must serialize");

    let request = ResolvedQuestionRequest {
        raw_params: serde_json::json!({ "templateId": "qt-migration-paths" }),
        resolved_questions,
        presentation: Some(presentation),
        template_id: Some("qt-migration-paths".to_string()),
        template_version: Some("1".to_string()),
        template_payload: Some(template_payload.clone()),
        // The template's legacy wire field keeps the same projection so older
        // surfaces and replays keep rendering.
        qt_migration_questions: Some(template_payload.clone()),
    };
    let encoded = serde_json::to_value(&request).expect("payload must serialize");

    // Raw model params are preserved as-is for replay/audit (never overwritten).
    assert_eq!(encoded["params"]["templateId"], "qt-migration-paths");
    // Actually-waited questions carry the backend field binding.
    assert_eq!(encoded["resolvedQuestions"][0]["field"], "source_project");
    assert_eq!(
        encoded["resolvedQuestions"].as_array().map(Vec::len),
        Some(4)
    );
    // Policy comes only from the backend template. The Qt intake must block on
    // the user: a skipped question would silently drop required migration paths.
    assert_eq!(encoded["presentation"]["allowSkip"], false);
    assert_eq!(encoded["presentation"]["allowTimeout"], false);
    assert_eq!(encoded["presentation"]["layout"], "wizard");
    assert_eq!(encoded["templateVersion"], "1");
    // No candidates passed to resolve -> template questions ship empty options
    // and rely on the free-text input (inputPlaceholder) for the real path.
    assert_eq!(
        encoded["resolvedQuestions"][0]["options"]
            .as_array()
            .map(Vec::len),
        Some(0)
    );
    assert_eq!(
        encoded["resolvedQuestions"][0]["inputPlaceholder"]
            .as_str()
            .map(|s| !s.trim().is_empty()),
        Some(true)
    );
    // The Qt template additionally ships its own question shape, which the Qt
    // intake card renders instead of the generic projection. Both carry the same
    // four field ids, and the candidate path stays free of display text.
    let qt_questions = encoded["qtMigrationQuestions"]
        .as_array()
        .expect("qtMigrationQuestions must ride on the envelope");
    assert_eq!(qt_questions.len(), 4);
    assert_eq!(qt_questions[2]["field"], "toolchain");
    assert_eq!(
        qt_questions[2]["prompt"],
        "askUser.qtMigration.question.toolchain"
    );
    assert_eq!(
        qt_questions[2]["options"][0]["value"], "__official__",
        "no usable toolchain -> the managed download option is the only option"
    );
    assert_eq!(qt_questions[2]["options"][0]["path"], "");
    assert!(qt_questions[2]["options"][0].get("version").is_none());
    // The generic payload and the legacy projection carry the same wire value,
    // so a surface reading either field renders the same card.
    assert_eq!(
        encoded["templatePayload"], encoded["qtMigrationQuestions"],
        "templatePayload is the generic name of the same opaque payload"
    );
}

#[test]
fn timeout_is_distinct_from_answer_or_cancellation() {
    let input = AskUserQuestionInput {
        questions: vec![question()],
        template_id: None,
        timeout_seconds: 30,
    };
    let result = bitfun_agent_runtime::user_questions::build_timed_out_user_question_result(&input);
    assert_eq!(
        result.data,
        serde_json::json!({ "questions_count": 1, "status": "timeout" })
    );
    assert_eq!(
        result.result_for_assistant,
        "用户无响应，跳过提问，继续执行"
    );
    assert!(result.data.get("answers").is_none());
}

#[test]
fn resolved_request_without_a_template_payload_omits_both_payload_fields() {
    use bitfun_agent_runtime::user_questions::ResolvedQuestionRequest;

    let request = ResolvedQuestionRequest {
        raw_params: serde_json::json!({ "questions": [] }),
        resolved_questions: vec![question()],
        presentation: None,
        template_id: None,
        template_version: None,
        template_payload: None,
        qt_migration_questions: None,
    };
    let encoded = serde_json::to_value(&request).expect("payload must serialize");
    assert!(
        encoded.get("templatePayload").is_none(),
        "a plain question carries no template payload"
    );
    assert!(
        encoded.get("qtMigrationQuestions").is_none(),
        "the legacy projection stays off the wire when there is nothing to project"
    );
    // The legacy shape (an old sender's payload: no templatePayload) still
    // deserializes — the envelope must keep reading payloads written before
    // the generic field existed.
    let legacy: ResolvedQuestionRequest = serde_json::from_value(serde_json::json!({
        "params": { "questions": [] },
        "resolvedQuestions": [question()],
        "templateId": "qt-migration-paths",
        "templateVersion": "1",
        "qtMigrationQuestions": [{ "field": "toolchain" }],
    }))
    .expect("a payload without templatePayload must deserialize");
    assert_eq!(
        legacy.qt_migration_questions,
        Some(serde_json::json!([{ "field": "toolchain" }]))
    );
    assert_eq!(legacy.template_payload, None);
}

#[test]
fn resolved_request_round_trips_an_opaque_template_payload_verbatim() {
    use bitfun_agent_runtime::user_questions::ResolvedQuestionRequest;

    // An arbitrary template-owned shape: the host never interprets it, so the
    // envelope must carry it through unchanged in both wire fields.
    let payload = serde_json::json!({
        "questions": [{ "id": "a", "kind": "future-template", "deep": { "keep": [1, 2] } }],
        "policy": { "anyKey": true },
    });
    let both = ResolvedQuestionRequest {
        raw_params: serde_json::json!({}),
        resolved_questions: vec![question()],
        presentation: None,
        template_id: Some("future-template".to_string()),
        template_version: Some("1".to_string()),
        template_payload: Some(payload.clone()),
        qt_migration_questions: Some(payload.clone()),
    };
    let encoded = serde_json::to_value(&both).expect("payload must serialize");
    assert_eq!(encoded["templatePayload"], payload);
    assert_eq!(encoded["qtMigrationQuestions"], payload);

    let decoded: ResolvedQuestionRequest =
        serde_json::from_value(encoded).expect("both-field payload must round-trip");
    assert_eq!(decoded.template_payload.as_ref(), Some(&payload));
    assert_eq!(decoded.qt_migration_questions.as_ref(), Some(&payload));

    // A sender that only knows the generic field still round-trips verbatim.
    let only_generic = ResolvedQuestionRequest {
        template_payload: Some(payload.clone()),
        qt_migration_questions: None,
        ..both
    };
    let encoded = serde_json::to_value(&only_generic).expect("payload must serialize");
    let decoded: ResolvedQuestionRequest =
        serde_json::from_value(encoded).expect("templatePayload-only payload must round-trip");
    assert_eq!(decoded.template_payload, Some(payload));
    assert_eq!(decoded.qt_migration_questions, None);
}
