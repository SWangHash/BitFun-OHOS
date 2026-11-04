#![cfg(feature = "git")]

use bitfun_runtime_ports::{GitPort, WorkspaceDiffContent, WorkspaceDiffFileStatus};
use bitfun_services_integrations::git::{
    build_git_changed_files_args, build_git_diff_args, execute_git_command, parse_branch_line,
    parse_git_log_line, parse_name_status_output, parse_worktree_list, GitAuthor, GitChangedFile,
    GitChangedFileStatus, GitChangedFilesParams, GitCommandOutput, GitCommitParams, GitDiffParams,
    GitError, GitGraph, GitLogParams, GitService, GitStatus, GitWorkspaceDiffPort, GitWorktreeInfo,
    GraphNode, GraphRef,
};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn git_changed_file_status_preserves_snake_case_contract() {
    let status = serde_json::to_value(GitChangedFileStatus::Renamed).unwrap();
    assert_eq!(status, serde_json::json!("renamed"));

    let changed_file = GitChangedFile {
        path: "src/new.rs".to_string(),
        old_path: Some("src/old.rs".to_string()),
        status: GitChangedFileStatus::Renamed,
    };

    let value = serde_json::to_value(changed_file).unwrap();
    assert_eq!(value["old_path"], "src/old.rs");
    assert_eq!(value["status"], "renamed");
}

#[test]
fn git_name_status_parser_preserves_common_status_contract() {
    let files = parse_name_status_output(
        "M\tsrc/main.rs\nA\tsrc/new.rs\nD\tsrc/old.rs\nR100\tsrc/old_name.rs\tsrc/new_name.rs\nC087\tsrc/source.rs\tsrc/copy.rs\n",
    );

    assert_eq!(
        files,
        vec![
            GitChangedFile {
                path: "src/main.rs".to_string(),
                old_path: None,
                status: GitChangedFileStatus::Modified,
            },
            GitChangedFile {
                path: "src/new.rs".to_string(),
                old_path: None,
                status: GitChangedFileStatus::Added,
            },
            GitChangedFile {
                path: "src/old.rs".to_string(),
                old_path: None,
                status: GitChangedFileStatus::Deleted,
            },
            GitChangedFile {
                path: "src/new_name.rs".to_string(),
                old_path: Some("src/old_name.rs".to_string()),
                status: GitChangedFileStatus::Renamed,
            },
            GitChangedFile {
                path: "src/copy.rs".to_string(),
                old_path: Some("src/source.rs".to_string()),
                status: GitChangedFileStatus::Copied,
            },
        ],
    );
}

#[test]
fn git_command_output_preserves_raw_stream_contract() {
    let output = GitCommandOutput {
        stdout: "ok".to_string(),
        stderr: "warning".to_string(),
        exit_code: 1,
    };

    assert_eq!(output.stdout, "ok");
    assert_eq!(output.stderr, "warning");
    assert_eq!(output.exit_code, 1);
}

#[test]
fn git_text_parsers_preserve_branch_and_log_contracts() {
    assert_eq!(
        parse_git_log_line("abc123|BitFun|bitfun@example.com|2026-05-12|subject|body"),
        Some((
            "abc123".to_string(),
            "BitFun".to_string(),
            "bitfun@example.com".to_string(),
            "2026-05-12".to_string(),
            "subject|body".to_string(),
        ))
    );
    assert_eq!(parse_git_log_line("abc123|missing"), None);

    assert_eq!(
        parse_branch_line("* main"),
        Some(("main".to_string(), true))
    );
    assert_eq!(
        parse_branch_line("  feature/test"),
        Some(("feature/test".to_string(), false))
    );
    assert_eq!(
        parse_branch_line("detached"),
        Some(("detached".to_string(), false))
    );
    assert_eq!(parse_branch_line("  "), None);
}

#[test]
fn git_diff_arg_builders_preserve_existing_command_contract() {
    let args = build_git_diff_args(&GitDiffParams {
        source: Some("main".to_string()),
        target: Some("feature".to_string()),
        files: Some(vec!["src/lib.rs".to_string(), "README.md".to_string()]),
        staged: Some(true),
        stat: Some(true),
        review_safe: Some(true),
    });
    assert_eq!(
        args,
        vec![
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--cached",
            "main..feature",
            "--stat",
            "--",
            "src/lib.rs",
            "README.md",
        ]
    );

    let target_only_args = build_git_diff_args(&GitDiffParams {
        source: None,
        target: Some("feature".to_string()),
        files: None,
        staged: None,
        stat: None,
        review_safe: None,
    });
    assert_eq!(target_only_args, vec!["diff"]);

    let changed_args = build_git_changed_files_args(&GitChangedFilesParams {
        source: None,
        target: Some("feature".to_string()),
        staged: Some(true),
        review_safe: Some(true),
    });
    assert_eq!(
        changed_args,
        vec![
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--name-status",
            "-z",
            "--cached",
            "feature",
        ]
    );
}

#[tokio::test]
async fn review_safe_workspace_diff_forces_rename_detection() {
    let repo_dir = TempRepoDir::new("review-workspace-rename");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    let original = (0..10)
        .map(|index| format!("stable line {index}\n"))
        .collect::<String>();
    fs::write(repo_dir.path().join("old.txt"), &original).unwrap();
    run_git(repo_dir.path(), &["add", "--", "old.txt"]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);
    run_git(repo_dir.path(), &["config", "diff.renames", "false"]);
    run_git(repo_dir.path(), &["mv", "old.txt", "new.txt"]);
    fs::write(
        repo_dir.path().join("new.txt"),
        original.replace("stable line 5", "edited line 5"),
    )
    .unwrap();

    let files = GitService::get_changed_files(
        repo_dir.path(),
        &GitChangedFilesParams {
            source: Some("HEAD".to_string()),
            review_safe: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, GitChangedFileStatus::Renamed);
    assert_eq!(files[0].old_path.as_deref(), Some("old.txt"));
    assert_eq!(files[0].path, "new.txt");

    let diff = GitService::get_diff(
        repo_dir.path(),
        &GitDiffParams {
            source: Some("HEAD".to_string()),
            files: Some(vec!["old.txt".to_string(), "new.txt".to_string()]),
            review_safe: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(diff.contains("rename from old.txt"));
    assert!(diff.contains("rename to new.txt"));
}

#[tokio::test]
async fn git_service_preserves_repository_status_contract() {
    let repo_dir = TempRepoDir::new("git-service-status");
    assert!(!GitService::is_repository(repo_dir.path()).await.unwrap());

    run_git(repo_dir.path(), &["init"]);
    fs::write(repo_dir.path().join("new-file.txt"), "hello\n").unwrap();

    assert!(GitService::is_repository(repo_dir.path()).await.unwrap());

    let status = GitService::get_status(repo_dir.path()).await.unwrap();
    assert!(status
        .untracked
        .iter()
        .any(|path| path == "new-file.txt" || path == "new-file.txt/"));
}

#[tokio::test]
async fn git_checkout_remote_branch_creates_and_reuses_a_local_tracking_branch() {
    let repo_dir = checkout_repo();

    let result = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");
    assert_eq!(
        GitService::get_repository_basic(repo_dir.path())
            .await
            .unwrap()
            .current_branch,
        "feature/topic"
    );
    let branches = GitService::get_branches(repo_dir.path(), true)
        .await
        .unwrap();
    let current = branches.iter().find(|branch| branch.current).unwrap();
    assert_eq!(current.name, "feature/topic");
    assert!(!current.remote);
    assert_eq!(current.upstream.as_deref(), Some("origin/feature/topic"));

    GitService::checkout_branch(repo_dir.path(), "main")
        .await
        .unwrap();
    let result = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");

    // A local branch ahead of the selected remote retains its commits.
    commit_checkout_fixture(repo_dir.path());
    let repository = git2::Repository::open(repo_dir.path()).unwrap();
    let local_commit = repository.head().unwrap().target();
    GitService::checkout_branch(repo_dir.path(), "main")
        .await
        .unwrap();

    let result = GitService::checkout_branch(repo_dir.path(), "refs/remotes/origin/feature/topic")
        .await
        .unwrap();
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");
    assert_eq!(repository.head().unwrap().target(), local_commit);
    assert!(!repository.head_detached().unwrap());

    run_git(
        repo_dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/feature/topic",
        ],
    );
    GitService::checkout_branch(repo_dir.path(), "main")
        .await
        .unwrap();
    let result = GitService::checkout_branch(repo_dir.path(), "origin/HEAD")
        .await
        .unwrap();
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");
}

#[tokio::test]
async fn git_checkout_success_survives_a_failed_branch_name_query() {
    let repo_dir = checkout_repo();
    let repo_path = repo_dir.path().to_str().unwrap();
    let repository = git2::Repository::open(repo_dir.path()).unwrap();

    for branch in [
        "refs/remotes/origin/feature/topic",
        "refs/heads/feature/topic",
    ] {
        run_git(repo_dir.path(), &["checkout", "main"]);
        let result = GitService::checkout_branch_with_executor(branch, |args| async move {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            if args == ["branch", "--show-current"] {
                return Err(GitError::CommandFailed(
                    "Branch name query failed after checkout".to_string(),
                ));
            }
            execute_git_command(repo_path, &args).await
        })
        .await
        .unwrap();

        assert!(result.success);
        assert_eq!(result.data.unwrap()["branch"], "feature/topic");
        assert_eq!(
            repository.head().unwrap().name().unwrap(),
            "refs/heads/feature/topic"
        );
    }
}

#[tokio::test]
async fn git_checkout_remote_fast_forwards_the_same_name_and_keeps_unrelated_changes() {
    let repo_dir = checkout_repo();
    run_git(repo_dir.path(), &["branch", "feature/topic"]);
    advance_checkout_remote(repo_dir.path(), &[("shared.txt", "remote revision\n")]);
    fs::write(repo_dir.path().join("notes.txt"), "staged notes\n").unwrap();
    run_git(repo_dir.path(), &["add", "notes.txt"]);
    fs::write(repo_dir.path().join("notes.txt"), "unstaged notes\n").unwrap();
    let repository = git2::Repository::open(repo_dir.path()).unwrap();
    let staged_notes = repository
        .index()
        .unwrap()
        .get_path(std::path::Path::new("notes.txt"), 0)
        .unwrap()
        .id;
    let remote_commit = repository
        .refname_to_id("refs/remotes/origin/feature/topic")
        .unwrap();

    let result = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");
    assert_eq!(repository.head().unwrap().target(), Some(remote_commit));
    assert_eq!(
        repository
            .index()
            .unwrap()
            .get_path(std::path::Path::new("notes.txt"), 0)
            .unwrap()
            .id,
        staged_notes
    );
    assert_eq!(
        fs::read_to_string(repo_dir.path().join("notes.txt")).unwrap(),
        "unstaged notes\n"
    );
    assert!(repository
        .find_branch("feature/topic", git2::BranchType::Local)
        .unwrap()
        .upstream()
        .is_err());

    // Updating an already-current tracking branch also preserves its upstream.
    run_git(
        repo_dir.path(),
        &[
            "branch",
            "--set-upstream-to=origin/feature/topic",
            "feature/topic",
        ],
    );
    advance_checkout_remote(repo_dir.path(), &[("shared.txt", "next remote revision\n")]);
    let result = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(
        repository.head().unwrap().target(),
        Some(
            repository
                .refname_to_id("refs/remotes/origin/feature/topic")
                .unwrap()
        )
    );
    assert_eq!(
        repository
            .find_branch("feature/topic", git2::BranchType::Local)
            .unwrap()
            .upstream()
            .unwrap()
            .name()
            .unwrap(),
        Some("origin/feature/topic")
    );
}

#[tokio::test]
async fn git_checkout_remote_divergence_keeps_head_branch_and_changes() {
    let repo_dir = checkout_repo();
    run_git(repo_dir.path(), &["checkout", "-b", "feature/topic"]);
    fs::write(repo_dir.path().join("local.txt"), "local commit\n").unwrap();
    commit_checkout_fixture(repo_dir.path());
    run_git(repo_dir.path(), &["checkout", "main"]);
    // These changes could merge cleanly, but the histories still diverge.
    advance_checkout_remote(repo_dir.path(), &[("remote.txt", "remote commit\n")]);
    fs::write(repo_dir.path().join("notes.txt"), "staged notes\n").unwrap();
    run_git(repo_dir.path(), &["add", "notes.txt"]);
    fs::write(repo_dir.path().join("notes.txt"), "unstaged notes\n").unwrap();
    fs::write(repo_dir.path().join("draft.txt"), "untracked draft\n").unwrap();
    let repository = git2::Repository::open(repo_dir.path()).unwrap();
    let head = repository.head().unwrap().target();
    let local_commit = repository
        .refname_to_id("refs/heads/feature/topic")
        .unwrap();
    let index_tree = repository.index().unwrap().write_tree().unwrap();

    let result = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
        .await
        .unwrap();
    assert!(!result.success);
    assert!(result.error.unwrap().starts_with("git_branch_diverged:"));
    assert!(result.data.is_none());
    assert_eq!(
        repository.head().unwrap().name().unwrap(),
        "refs/heads/main"
    );
    assert_eq!(repository.head().unwrap().target(), head);
    assert_eq!(
        repository
            .refname_to_id("refs/heads/feature/topic")
            .unwrap(),
        local_commit
    );
    assert_eq!(
        repository.index().unwrap().write_tree().unwrap(),
        index_tree
    );
    assert_eq!(
        fs::read_to_string(repo_dir.path().join("notes.txt")).unwrap(),
        "unstaged notes\n"
    );
    assert_eq!(
        fs::read_to_string(repo_dir.path().join("draft.txt")).unwrap(),
        "untracked draft\n"
    );
    assert!(!repo_dir.path().join("remote.txt").exists());
    assert!(!repo_dir.path().join("local.txt").exists());

    // Explicit local checkout retains normal behavior, without remote syncing.
    let result = GitService::checkout_branch(repo_dir.path(), "refs/heads/feature/topic")
        .await
        .unwrap();
    assert!(result.success);
    assert_eq!(result.data.unwrap()["branch"], "feature/topic");
    assert_eq!(repository.head().unwrap().target(), Some(local_commit));
}

#[tokio::test]
async fn git_checkout_remote_overwrite_failure_keeps_head_branch_and_changes() {
    for untracked in [false, true] {
        let repo_dir = checkout_repo();
        // Cover both a blocked fast-forward and a blocked new tracking branch.
        if !untracked {
            run_git(repo_dir.path(), &["branch", "feature/topic"]);
        }
        let blocked_file = if untracked {
            "incoming.txt"
        } else {
            "shared.txt"
        };
        advance_checkout_remote(repo_dir.path(), &[(blocked_file, "remote contents\n")]);
        fs::write(repo_dir.path().join(blocked_file), "staged contents\n").unwrap();
        if !untracked {
            run_git(repo_dir.path(), &["add", blocked_file]);
        }
        fs::write(repo_dir.path().join(blocked_file), "local contents\n").unwrap();
        let repository = git2::Repository::open(repo_dir.path()).unwrap();
        let head = repository.head().unwrap().target();
        let local_commit = repository.refname_to_id("refs/heads/feature/topic").ok();
        let index_tree = repository.index().unwrap().write_tree().unwrap();

        let error = GitService::checkout_branch(repo_dir.path(), "origin/feature/topic")
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("would be overwritten by checkout"));
        assert_eq!(
            repository.head().unwrap().name().unwrap(),
            "refs/heads/main"
        );
        assert_eq!(repository.head().unwrap().target(), head);
        assert_eq!(
            repository.refname_to_id("refs/heads/feature/topic").ok(),
            local_commit
        );
        assert_eq!(
            repository.index().unwrap().write_tree().unwrap(),
            index_tree
        );
        assert_eq!(
            fs::read_to_string(repo_dir.path().join(blocked_file)).unwrap(),
            "local contents\n"
        );
    }
}

#[tokio::test]
async fn changed_files_uses_the_index_as_the_empty_base_before_the_first_commit() {
    let repo_dir = TempRepoDir::new("unborn-head-changed-files");
    run_git(repo_dir.path(), &["init"]);
    fs::write(repo_dir.path().join("first.txt"), "first revision\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "first.txt"]);

    let files = GitService::get_changed_files(
        repo_dir.path(),
        &GitChangedFilesParams {
            source: Some("HEAD".to_string()),
            review_safe: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("changed files for unborn HEAD");

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "first.txt");
    assert_eq!(files[0].status, GitChangedFileStatus::Added);
}

#[tokio::test]
async fn workspace_diff_port_reports_staged_unstaged_and_untracked_changes() {
    let repo_dir = TempRepoDir::new("workspace-diff-port");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    fs::write(repo_dir.path().join("both.txt"), "base\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "both.txt"]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);

    fs::write(repo_dir.path().join("both.txt"), "base\nstaged\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "both.txt"]);
    fs::write(repo_dir.path().join("both.txt"), "base\nstaged\nunstaged\n").unwrap();
    fs::write(repo_dir.path().join("new.txt"), "untracked\n").unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");

    let both = snapshot
        .files
        .iter()
        .find(|file| file.path == "both.txt")
        .expect("tracked file");
    assert_eq!(both.status, WorkspaceDiffFileStatus::Modified);
    assert!(both.staged);
    assert!(both.unstaged);
    assert!(!both.untracked);
    assert!(matches!(
        &both.content,
        WorkspaceDiffContent::Text { patch } if patch.contains("+staged") && patch.contains("+unstaged")
    ));

    let untracked = snapshot
        .files
        .iter()
        .find(|file| file.path == "new.txt")
        .expect("untracked file");
    assert_eq!(untracked.status, WorkspaceDiffFileStatus::Added);
    assert!(untracked.untracked);
    assert!(matches!(
        &untracked.content,
        WorkspaceDiffContent::Text { patch } if patch.contains("+untracked")
    ));
    assert!(!snapshot.truncated);
}

#[tokio::test]
async fn workspace_diff_port_keeps_staged_changes_when_worktree_returns_to_head() {
    let repo_dir = TempRepoDir::new("workspace-diff-cancelled-worktree");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    fs::write(repo_dir.path().join("both.txt"), "base\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "both.txt"]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);

    fs::write(repo_dir.path().join("both.txt"), "staged\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "both.txt"]);
    fs::write(repo_dir.path().join("both.txt"), "base\n").unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");

    let both = snapshot
        .files
        .iter()
        .find(|file| file.path == "both.txt")
        .expect("staged change must remain visible");
    assert!(both.staged);
    assert!(both.unstaged);
    assert!(matches!(&both.content, WorkspaceDiffContent::Text { .. }));
}

#[tokio::test]
async fn workspace_diff_port_keeps_staged_additions_deleted_from_the_worktree() {
    let repo_dir = TempRepoDir::new("workspace-diff-staged-add-deleted");
    run_git(repo_dir.path(), &["init"]);
    fs::write(repo_dir.path().join("added.txt"), "staged\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "added.txt"]);
    fs::remove_file(repo_dir.path().join("added.txt")).unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");
    let added = snapshot
        .files
        .iter()
        .find(|file| file.path == "added.txt")
        .expect("status-only staged addition must remain visible");

    assert_eq!(added.status, WorkspaceDiffFileStatus::Added);
    assert!(added.staged);
    assert!(added.unstaged);
    assert!(!added.untracked);
    assert!(matches!(
        &added.content,
        WorkspaceDiffContent::Text { patch } if patch.is_empty()
    ));
}

#[tokio::test]
async fn workspace_diff_port_preserves_staged_delete_and_recreated_file_sources() {
    let repo_dir = TempRepoDir::new("workspace-diff-staged-delete-recreated");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    fs::write(repo_dir.path().join("rebuilt.txt"), "base\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "rebuilt.txt"]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);
    run_git(repo_dir.path(), &["rm", "--cached", "--", "rebuilt.txt"]);
    fs::write(repo_dir.path().join("rebuilt.txt"), "rebuilt\n").unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");
    let rebuilt = snapshot
        .files
        .iter()
        .find(|file| file.path == "rebuilt.txt")
        .expect("recreated file");

    assert!(rebuilt.staged);
    assert!(rebuilt.untracked);
}

#[tokio::test]
async fn workspace_diff_port_marks_conflicts_without_projecting_an_incomplete_patch() {
    let repo_dir = TempRepoDir::new("workspace-diff-conflict");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    fs::write(repo_dir.path().join("conflict.txt"), "base\n").unwrap();
    run_git(repo_dir.path(), &["add", "--", "conflict.txt"]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);
    run_git(repo_dir.path(), &["branch", "-M", "main"]);
    run_git(repo_dir.path(), &["checkout", "-b", "side"]);
    fs::write(repo_dir.path().join("conflict.txt"), "side\n").unwrap();
    run_git(repo_dir.path(), &["commit", "-am", "side"]);
    run_git(repo_dir.path(), &["checkout", "main"]);
    fs::write(repo_dir.path().join("conflict.txt"), "main\n").unwrap();
    run_git(repo_dir.path(), &["commit", "-am", "main"]);
    run_git_expect_failure(repo_dir.path(), &["merge", "side"]);

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");
    let conflict = snapshot
        .files
        .iter()
        .find(|file| file.path == "conflict.txt")
        .expect("conflicted file");

    assert_eq!(conflict.status, WorkspaceDiffFileStatus::Conflicted);
    assert!(matches!(
        &conflict.content,
        WorkspaceDiffContent::Text { patch } if patch.is_empty()
    ));
}

#[tokio::test]
async fn workspace_diff_port_scopes_parent_repository_paths_to_the_bound_workspace() {
    let repo_dir = TempRepoDir::new("workspace-diff-scope");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "tests@bitfun.dev"],
    );
    fs::create_dir_all(repo_dir.path().join("scope[1]")).unwrap();
    fs::write(repo_dir.path().join("outside.txt"), "base\n").unwrap();
    fs::write(
        repo_dir.path().join("scope[1]").join("inside.txt"),
        "base\n",
    )
    .unwrap();
    run_git(repo_dir.path(), &["add", "."]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);

    fs::write(repo_dir.path().join("outside.txt"), "outside change\n").unwrap();
    fs::write(
        repo_dir.path().join("scope[1]").join("inside.txt"),
        "inside change\n",
    )
    .unwrap();
    fs::write(repo_dir.path().join("scope[1]").join("new.txt"), "new\n").unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path().join("scope[1]"))
        .workspace_diff()
        .await
        .expect("workspace diff");

    assert_eq!(
        snapshot
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        vec!["inside.txt", "new.txt"]
    );
}

#[tokio::test]
async fn workspace_diff_port_omits_large_text_before_building_a_patch() {
    let repo_dir = TempRepoDir::new("workspace-diff-large-text");
    run_git(repo_dir.path(), &["init"]);
    fs::write(
        repo_dir.path().join("large.txt"),
        "x".repeat(1024 * 1024 + 1),
    )
    .unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");
    let large = snapshot
        .files
        .iter()
        .find(|file| file.path == "large.txt")
        .expect("large file");

    assert_eq!(large.content, WorkspaceDiffContent::TooLarge);
    assert!(snapshot.truncated);
}

#[tokio::test]
async fn workspace_diff_port_stops_projecting_content_after_the_total_text_cap() {
    let repo_dir = TempRepoDir::new("workspace-diff-total-cap");
    run_git(repo_dir.path(), &["init"]);
    for name in ["a.txt", "b.txt", "c.txt", "d.txt"] {
        fs::write(repo_dir.path().join(name), "x".repeat(800 * 1024)).unwrap();
    }
    fs::write(repo_dir.path().join("z.bin"), [0, 1, 0, 2]).unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");

    assert!(snapshot.truncated);
    assert_eq!(
        snapshot
            .files
            .iter()
            .find(|file| file.path == "d.txt")
            .expect("first over-budget file")
            .content,
        WorkspaceDiffContent::TooLarge
    );
    assert_eq!(
        snapshot
            .files
            .iter()
            .find(|file| file.path == "z.bin")
            .expect("later file")
            .content,
        WorkspaceDiffContent::TooLarge
    );
}

#[tokio::test]
async fn workspace_diff_port_marks_binary_content_without_text_projection() {
    let repo_dir = TempRepoDir::new("workspace-diff-binary");
    run_git(repo_dir.path(), &["init"]);
    fs::write(repo_dir.path().join("binary.dat"), [0, 1, 2, 0, 3]).unwrap();

    let snapshot = GitWorkspaceDiffPort::new(repo_dir.path())
        .workspace_diff()
        .await
        .expect("workspace diff");
    let binary = snapshot
        .files
        .iter()
        .find(|file| file.path == "binary.dat")
        .expect("binary file");

    assert_eq!(binary.content, WorkspaceDiffContent::Binary);
}

#[test]
fn git_name_status_parser_preserves_nul_delimited_unicode_and_rename_paths() {
    let files = parse_name_status_output("M\0src/中文.rs\0R100\0old name.rs\0new name.rs\0");
    assert_eq!(
        files,
        vec![
            GitChangedFile {
                path: "src/中文.rs".to_string(),
                old_path: None,
                status: GitChangedFileStatus::Modified,
            },
            GitChangedFile {
                path: "new name.rs".to_string(),
                old_path: Some("old name.rs".to_string()),
                status: GitChangedFileStatus::Renamed,
            },
        ]
    );
}

#[test]
fn git_status_json_preserves_conflict_contract() {
    let status = GitStatus {
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicts: vec!["src/conflicted.rs".to_string()],
        current_branch: "main".to_string(),
        ahead: 0,
        behind: 0,
    };
    assert_eq!(
        serde_json::to_value(status).unwrap()["conflicts"],
        serde_json::json!(["src/conflicted.rs"])
    );
}

#[tokio::test]
async fn review_git_service_reads_exact_renamed_and_deleted_range_without_mutation() {
    let repo_dir = TempRepoDir::new("review-exact-range");
    run_git(repo_dir.path(), &["init"]);
    run_git(
        repo_dir.path(),
        &["config", "user.name", "BitFun Tests"],
    );
    run_git(
        repo_dir.path(),
        &["config", "user.email", "bitfun-tests@example.com"],
    );
    fs::write(
        repo_dir.path().join(".gitattributes"),
        "*.txt diff=reviewdriver\n",
    )
    .unwrap();
    fs::write(repo_dir.path().join("renamed.txt"), "before rename\n").unwrap();
    fs::write(repo_dir.path().join("deleted.txt"), "deleted content\n").unwrap();
    fs::write(
        repo_dir.path().join(" leading whitespace.txt"),
        "before whitespace\n",
    )
    .unwrap();
    run_git(repo_dir.path(), &["add", "."]);
    run_git(repo_dir.path(), &["commit", "-m", "base"]);
    let base = GitService::resolve_revision(repo_dir.path(), "HEAD")
        .await
        .unwrap();

    run_git(repo_dir.path(), &["mv", "renamed.txt", "moved.txt"]);
    run_git(repo_dir.path(), &["rm", "deleted.txt"]);
    fs::write(repo_dir.path().join("moved.txt"), "after rename\n").unwrap();
    fs::write(
        repo_dir.path().join(" leading whitespace.txt"),
        "after whitespace\n",
    )
    .unwrap();
    run_git(repo_dir.path(), &["add", "."]);
    run_git(repo_dir.path(), &["commit", "-m", "target"]);
    let head = GitService::resolve_revision(repo_dir.path(), "HEAD")
        .await
        .unwrap();

    run_git(
        repo_dir.path(),
        &[
            "config",
            "diff.external",
            "bitfun-review-should-not-run",
        ],
    );
    run_git(
        repo_dir.path(),
        &[
            "config",
            "diff.reviewdriver.textconv",
            "bitfun-review-should-not-run",
        ],
    );

    let diff = GitService::get_review_diff(
        repo_dir.path(),
        &base,
        &head,
        &[
            "renamed.txt".to_string(),
            "moved.txt".to_string(),
            "deleted.txt".to_string(),
            " leading whitespace.txt".to_string(),
        ],
    )
    .await
    .unwrap();
    assert!(diff.contains("moved.txt"));
    assert!(diff.contains("deleted.txt"));
    assert!(diff.contains("after rename"));
    assert!(diff.contains("after whitespace"));

    let generic_diff = GitService::get_diff(
        repo_dir.path(),
        &GitDiffParams {
            source: Some(base.clone()),
            target: Some(head.clone()),
            files: Some(vec!["moved.txt".to_string()]),
            staged: None,
            stat: None,
            review_safe: Some(true),
        },
    )
    .await
    .expect("generic read-only diff must ignore external diff and textconv helpers");
    assert!(generic_diff.contains("after rename"));

    let wildcard_diff =
        GitService::get_review_diff(repo_dir.path(), &base, &head, &["*.txt".to_string()])
            .await
            .unwrap();
    assert!(wildcard_diff.is_empty());

    let status = GitService::get_status(repo_dir.path()).await.unwrap();
    assert!(status.staged.is_empty());
    assert!(status.unstaged.is_empty());
    assert!(status.untracked.is_empty());
    assert!(status.conflicts.is_empty());
}

#[tokio::test]
async fn review_git_service_rejects_mutable_revisions_and_escaping_paths() {
    let repo_dir = TempRepoDir::new("review-input-boundary");

    let mutable_revision = GitService::get_review_diff(
        repo_dir.path(),
        "main",
        "feature",
        &["src/lib.rs".to_string()],
    )
    .await;
    assert!(mutable_revision.is_err());

    let escaping_path = GitService::get_review_diff(
        repo_dir.path(),
        &"1".repeat(40),
        &"2".repeat(40),
        &["../outside.rs".to_string()],
    )
    .await;
    assert!(escaping_path.is_err());

    let nul_path = GitService::get_review_diff(
        repo_dir.path(),
        &"1".repeat(40),
        &"2".repeat(40),
        &["src/nul\0path.rs".to_string()],
    )
    .await;
    assert!(
        matches!(nul_path, Err(GitError::InvalidPath(message)) if message.contains("workspace-relative"))
    );
}

struct TempRepoDir {
    path: std::path::PathBuf,
}

impl TempRepoDir {
    fn new(name: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "bitfun-services-integrations-{}-{}-{}",
            name,
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempRepoDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn checkout_repo() -> TempRepoDir {
    let repo_dir = TempRepoDir::new("git-checkout");
    run_git(repo_dir.path(), &["init", "-b", "main"]);
    fs::write(repo_dir.path().join("shared.txt"), "base revision\n").unwrap();
    fs::write(repo_dir.path().join("notes.txt"), "base notes\n").unwrap();
    commit_checkout_fixture(repo_dir.path());
    run_git(
        repo_dir.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://example.com/repository.git",
        ],
    );
    run_git(
        repo_dir.path(),
        &["update-ref", "refs/remotes/origin/feature/topic", "HEAD"],
    );
    repo_dir
}

fn commit_checkout_fixture(repo_dir: &std::path::Path) {
    run_git(repo_dir, &["add", "--all"]);
    run_git(
        repo_dir,
        &[
            "-c",
            "user.name=BitFun Tests",
            "-c",
            "user.email=tests@bitfun.dev",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "test: update checkout fixture",
            "-m",
            "Prepare branch history for checkout verification.",
        ],
    );
}

fn advance_checkout_remote(repo_dir: &std::path::Path, files: &[(&str, &str)]) {
    let repository = git2::Repository::open(repo_dir).unwrap();
    let parent = repository
        .find_reference("refs/remotes/origin/feature/topic")
        .unwrap()
        .peel_to_commit()
        .unwrap();
    let tree = parent.tree().unwrap();
    let mut builder = repository.treebuilder(Some(&tree)).unwrap();
    for (name, contents) in files {
        let blob = repository.blob(contents.as_bytes()).unwrap();
        builder.insert(name, blob, 0o100644).unwrap();
    }
    let tree = repository.find_tree(builder.write().unwrap()).unwrap();
    let signature = git2::Signature::now("BitFun Tests", "tests@bitfun.dev").unwrap();
    repository.commit(Some("refs/remotes/origin/feature/topic"), &signature, &signature,
        "test: advance remote fixture\n\nPrepare fetched remote history for checkout verification.\n",
        &tree, &[&parent]).unwrap();
}

fn run_git(repo_dir: &std::path::Path, args: &[&str]) {
    let output = bitfun_services_core::process_manager::create_command("git")
        .current_dir(repo_dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn run_git_expect_failure(repo_dir: &std::path::Path, args: &[&str]) {
    let output = bitfun_services_core::process_manager::create_command("git")
        .current_dir(repo_dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        !output.status.success(),
        "git {:?} unexpectedly succeeded",
        args
    );
}

#[test]
fn git_worktree_info_preserves_camel_case_contract() {
    let worktree = GitWorktreeInfo {
        path: "D:/workspace/BitFun-worktree".to_string(),
        branch: Some("feature/test".to_string()),
        head: "abc123".to_string(),
        is_main: false,
        is_locked: true,
        is_prunable: false,
    };

    let value = serde_json::to_value(worktree).unwrap();
    assert_eq!(value["isMain"], false);
    assert_eq!(value["isLocked"], true);
    assert_eq!(value["isPrunable"], false);
}

#[test]
fn git_worktree_parser_preserves_porcelain_contract() {
    let worktrees = parse_worktree_list(
        "worktree D:/workspace/BitFun\nHEAD abc123\nbranch refs/heads/main\n\nworktree D:/workspace/BitFun-feature\nHEAD def456\nbranch refs/heads/feature/test\nlocked\nprunable\n",
    );

    assert_eq!(worktrees.len(), 2);
    assert_eq!(worktrees[0].path, "D:/workspace/BitFun");
    assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    assert_eq!(worktrees[0].head, "abc123");
    assert!(worktrees[0].is_main);
    assert!(!worktrees[0].is_locked);
    assert_eq!(worktrees[1].branch.as_deref(), Some("feature/test"));
    assert!(worktrees[1].is_locked);
    assert!(worktrees[1].is_prunable);
}

#[test]
fn git_commit_params_preserves_no_verify_rename_contract() {
    let params = GitCommitParams {
        message: "test commit".to_string(),
        amend: Some(false),
        all: Some(true),
        no_verify: Some(true),
        author: Some(GitAuthor {
            name: "BitFun".to_string(),
            email: "bitfun@example.com".to_string(),
        }),
    };

    let value = serde_json::to_value(params).unwrap();
    assert_eq!(value["noVerify"], true);
    assert!(value.get("no_verify").is_none());
}

#[test]
fn git_graph_contract_preserves_camel_case_contract() {
    let graph = GitGraph {
        nodes: vec![GraphNode {
            hash: "abc123".to_string(),
            message: "initial".to_string(),
            full_message: "initial commit".to_string(),
            author_name: "BitFun".to_string(),
            author_email: "bitfun@example.com".to_string(),
            timestamp: 1_700_000_000,
            parents: Vec::new(),
            children: vec!["def456".to_string()],
            refs: vec![GraphRef {
                name: "main".to_string(),
                ref_type: "branch".to_string(),
                is_current: true,
                is_head: true,
            }],
            lane: 0,
            forking_lanes: Vec::new(),
            merging_lanes: Vec::new(),
            passing_lanes: Vec::new(),
        }],
        max_lane: 1,
        current_branch: Some("main".to_string()),
    };

    let value = serde_json::to_value(graph).unwrap();
    assert_eq!(value["maxLane"], 1);
    assert_eq!(value["currentBranch"], "main");
    assert_eq!(value["nodes"][0]["fullMessage"], "initial commit");
    assert_eq!(value["nodes"][0]["refs"][0]["refType"], "branch");
    assert_eq!(value["nodes"][0]["refs"][0]["isCurrent"], true);
}

#[test]
fn git_log_params_path_round_trips_camel_case_contract() {
    let params = GitLogParams {
        max_count: Some(20),
        skip: Some(2),
        author: Some("alice".to_string()),
        grep: Some("fix".to_string()),
        since: Some("2024-01-01".to_string()),
        until: None,
        stat: Some(true),
        path: Some("src/git/service.rs".to_string()),
    };

    let value = serde_json::to_value(params).unwrap();
    assert_eq!(value["maxCount"], 20);
    assert_eq!(value["skip"], 2);
    assert_eq!(value["path"], "src/git/service.rs");

    let wire = r#"{"maxCount":20,"skip":2,"author":"alice","grep":"fix","since":"2024-01-01","until":null,"stat":true,"path":"src/git/service.rs"}"#;
    let restored: GitLogParams = serde_json::from_str(wire).unwrap();
    assert_eq!(restored.path.as_deref(), Some("src/git/service.rs"));
    assert_eq!(restored.max_count, Some(20));
    assert!(restored.until.is_none());
}
