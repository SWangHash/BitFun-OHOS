use bitfun_agent_runtime::user_questions::{
    ask_user_question_available_for_acp_transport, ask_user_question_available_in_context,
    build_answered_user_question_result, build_cancelled_user_question_result,
    validate_ask_user_question_input, AskUserQuestionInput, Question, QuestionOption,
};

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
    };
    let encoded_plain = serde_json::to_value(&plain).expect("input should serialize");
    assert!(encoded_plain.get("templateId").is_none());
}

#[test]
fn ask_user_question_template_registry_serves_qt_migration_paths() {
    use bitfun_agent_runtime::question_templates::{
        resolve_question_template, QT_MIGRATION_PATHS_TEMPLATE_ID,
    };

    let questions = resolve_question_template(QT_MIGRATION_PATHS_TEMPLATE_ID)
        .expect("qt-migration-paths template must resolve");
    assert_eq!(questions.len(), 4);
    // Every question carries an input placeholder so users can type real paths.
    assert!(questions.iter().all(|q| q
        .input_placeholder
        .as_deref()
        .is_some_and(|s| !s.trim().is_empty())));
    // The template passes the shared validation so the tool can use it as-is.
    assert!(validate_ask_user_question_input(
        &AskUserQuestionInput {
            questions,
            template_id: Some(QT_MIGRATION_PATHS_TEMPLATE_ID.to_string()),
        },
        true
    )
    .is_ok());

    assert!(resolve_question_template("unknown-template").is_none());
}

#[test]
fn template_resolved_payload_keeps_params_immutable_and_carries_policy() {
    use bitfun_agent_runtime::question_templates::{
        resolve_question_template_full, QT_MIGRATION_PATHS_TEMPLATE_ID,
    };
    use bitfun_agent_runtime::user_questions::ResolvedQuestionRequest;

    let resolved = resolve_question_template_full(
        QT_MIGRATION_PATHS_TEMPLATE_ID,
        &std::collections::HashMap::new(),
    )
    .expect("template must resolve");
    let request = ResolvedQuestionRequest {
        raw_params: serde_json::json!({ "templateId": "qt-migration-paths" }),
        resolved_questions: resolved.questions.clone(),
        presentation: Some(resolved.presentation),
        template_id: Some(QT_MIGRATION_PATHS_TEMPLATE_ID.to_string()),
        template_version: Some(resolved.template_version),
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
    // Policy comes only from the backend template.
    assert_eq!(encoded["presentation"]["allowSkip"], false);
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
}
