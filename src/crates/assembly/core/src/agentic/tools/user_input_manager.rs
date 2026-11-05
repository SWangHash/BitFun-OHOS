//! Compatibility facade for user-question waiting channels.

pub use bitfun_agent_runtime::user_questions::{
    get_user_input_manager, wait_for_user_question_response, PendingUserQuestion, UserInputManager,
    UserInputResponse, UserQuestionWaitOutcome, USER_INPUT_MANAGER,
};
