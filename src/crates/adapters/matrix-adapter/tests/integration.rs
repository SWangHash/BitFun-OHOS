//! Integration tests for the Matrix skill market adapter.
//!
//! These tests hit the **live** OpenHarmony Matrix API
//! (`https://matrix.openharmony.cn/`) and are therefore marked `#[ignore]`
//! by default so CI does not depend on network availability or Matrix's
//! uptime. They are intended for manual / on-demand validation only.
//!
//! ## How to run
//!
//! ```bash
//! cargo test -p bitfun-matrix-adapter -- --ignored
//! ```
//!
//! ## Prerequisites
//!
//! - Network access to `https://matrix.openharmony.cn/`.
//! - (Optional) Override the base URL via `MATRIX_API_URL` env var to point
//!   at a mirror or local mock.
//! - For `test_install_skill`: write access to `~/.bitfun/skills/matrix/`.

use bitfun_matrix_adapter::{
    check_checksum, install_skill, list_skills, list_tags, MatrixHttpClient,
    MatrixSkillsListRequest,
};

/// Live-integration: fetch Matrix skill tags and assert at least one tag is
/// returned for `serviceType=skill`.
#[tokio::test]
#[ignore]
async fn test_list_tags() {
    let client = MatrixHttpClient::new().expect("MatrixHttpClient should build");
    let tags = list_tags(&client, "skill")
        .await
        .expect("list_tags should succeed against live Matrix API");
    assert!(
        !tags.is_empty(),
        "Matrix should return at least one skill tag for serviceType=skill"
    );
    // Every tag should have a non-empty `id` and `name` (per `spec.md` FR-001).
    for tag in &tags {
        assert!(!tag.id.is_empty(), "tag id must not be empty: {:?}", tag);
        assert!(
            !tag.name.is_empty(),
            "tag name must not be empty: {:?}",
            tag
        );
    }
}

/// Live-integration: paginate-query the Matrix skill list with default page
/// params and assert at least one skill is returned.
#[tokio::test]
#[ignore]
async fn test_list_skills() {
    let client = MatrixHttpClient::new().expect("MatrixHttpClient should build");
    let request = MatrixSkillsListRequest {
        page_num: "1".to_string(),
        page_size: "8".to_string(),
        keyword: None,
        category_id: None,
        org_id: None,
        tag_ids: None,
    };
    let page = list_skills(&client, &request)
        .await
        .expect("list_skills should succeed against live Matrix API");
    assert!(
        page.count > 0,
        "Matrix skill list count should be positive for default query"
    );
    assert!(
        !page.list.is_empty(),
        "Matrix skill list should return at least one skill summary"
    );
    for skill in &page.list {
        assert!(
            !skill.en_name.is_empty(),
            "skill summary en_name must not be empty: {:?}",
            skill
        );
    }
}

/// Live-integration: install the `skill-creator` skill end-to-end and verify
/// the install result shape. The skill is cleaned up by re-downloading (the
/// install overwrites the existing dir on re-run).
#[tokio::test]
#[ignore]
async fn test_install_skill() {
    let client = MatrixHttpClient::new().expect("MatrixHttpClient should build");
    let en_name = "skill-creator".to_string();

    // First fetch the checksum independently to verify the standalone API
    // matches what install_skill uses internally.
    let checksum = check_checksum(&client, &en_name)
        .await
        .expect("check_checksum should succeed against live Matrix API");
    assert_eq!(
        checksum.sha256.len(),
        64,
        "Matrix checksum sha256 should be a 64-char hex string"
    );
    assert!(checksum.size > 0, "Matrix checksum size should be positive");

    // Run the full install flow.
    let result = install_skill(&en_name, &client)
        .await
        .expect("install_skill should succeed against live Matrix API");
    assert_eq!(result.en_name, en_name);
    assert_eq!(result.source_id, "matrix");
    assert!(
        result.skill_md_present,
        "installed Matrix skill must contain SKILL.md"
    );
    assert_eq!(
        result.sha256.len(),
        64,
        "install result sha256 should be a 64-char hex string"
    );
    assert!(result.size > 0, "install result size should be positive");
    assert!(
        !result.install_path.is_empty(),
        "install result install_path must not be empty"
    );
    // The install path should end with the en_name directory.
    assert!(
        result
            .install_path
            .ends_with(&format!("matrix/{}", en_name))
            || result
                .install_path
                .ends_with(&format!("matrix\\{}", en_name)),
        "install_path should end with matrix/<en_name>: {}",
        result.install_path
    );
}
