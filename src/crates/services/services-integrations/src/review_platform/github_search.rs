//! Incremental personal PR search over repository connections, without the
//! Search API's result window. Each invocation reads at most one page per repo.

use super::*;
use std::collections::VecDeque;

const CANDIDATE_QUERY: &str = r#"
query($owner: String!, $name: String!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, states: OPEN,
                 orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      edges {
        cursor
        node {
          number title state isDraft author { login }
          headRefName headRefOid baseRefName baseRefOid updatedAt url
          additions deletions changedFiles comments { totalCount } reviewDecision
          checkSummary: commits(last: 1) {
            nodes { commit { statusCheckRollup { contexts {
              checkRunCountsByState { state count }
              statusContextCountsByState { state count }
            } } } }
          }
        }
      }
    }
  }
}
"#;

struct CandidatePage {
    progress: ReviewPlatformGithubSearchCursor,
    author: String,
    items: VecDeque<(String, ReviewPlatformPullRequest)>,
    has_next: bool,
}

fn search_contexts(
    remotes: &[ReviewPlatformRemote],
    remote_id: Option<&str>,
    auth_tokens: &ReviewPlatformAuthTokens,
) -> Result<Vec<ProviderContext>, ReviewPlatformError> {
    let mut seen = HashSet::new();
    remotes
        .iter()
        .filter(|remote| {
            remote.platform == ReviewPlatformKind::Github
                && remote.supported
                && remote.auth_state == ReviewAuthState::Connected
                && remote_id.is_none_or(|id| remote.id == id)
        })
        .filter(|remote| {
            seen.insert(format!("{}:{}", remote.host, remote.project_path).to_lowercase())
        })
        .map(|remote| provider_context(remote.clone(), auth_tokens))
        .collect()
}

pub(super) async fn search_batch(
    remotes: &[ReviewPlatformRemote],
    remote_id: Option<&str>,
    auth_tokens: &ReviewPlatformAuthTokens,
    requested: PullRequestPagination,
    search: &ReviewPlatformListSearch,
) -> Result<list_search::SearchPage, ReviewPlatformError> {
    let contexts = search_contexts(remotes, remote_id, auth_tokens)?;
    let previous = search.continuation.as_ref();
    if let Some(previous) = previous {
        let expected = contexts
            .iter()
            .map(|ctx| ctx.remote.id.as_str())
            .collect::<HashSet<_>>();
        let actual = previous
            .github_repositories
            .iter()
            .map(|cursor| cursor.remote_id.as_str())
            .collect::<HashSet<_>>();
        if expected != actual {
            return Err(ReviewPlatformError::Api(
                "Search repositories changed. Refresh the pull request search to continue.".into(),
            ));
        }
    }
    let results = stream::iter(contexts.into_iter().map(|ctx| async move {
        let progress = previous
            .and_then(|value| value.github_repositories.iter().find(|cursor| cursor.remote_id == ctx.remote.id))
            .cloned()
            .unwrap_or(ReviewPlatformGithubSearchCursor {
                remote_id: ctx.remote.id.clone(),
                after: None,
                exhausted: false,
            });
        if progress.exhausted {
            return Ok(CandidatePage { progress, author: String::new(), items: VecDeque::new(), has_next: false });
        }
        let value = github_api_post_json(&ctx, &format!("{}/graphql", ctx.api_base_url), &json!({
            "query": CANDIDATE_QUERY,
            "variables": { "owner": ctx.remote.owner, "name": ctx.remote.repository_name, "after": progress.after }
        })).await?;
        candidate_page(&ctx, progress, &value)
    }))
    .buffered(PROVIDER_ENRICH_CONCURRENCY)
    .collect::<Vec<Result<_, ReviewPlatformError>>>()
    .await;
    // A failed repository must not make an incomplete search look complete.
    let pages = results.into_iter().collect::<Result<Vec<_>, _>>()?;
    Ok(merge_batch(pages, requested, search))
}

fn candidate_page(
    ctx: &ProviderContext,
    progress: ReviewPlatformGithubSearchCursor,
    value: &Value,
) -> Result<CandidatePage, ReviewPlatformError> {
    if let Some(errors) = value
        .get("errors")
        .and_then(Value::as_array)
        .filter(|errors| !errors.is_empty())
    {
        let messages = errors
            .iter()
            .map(|error| value_string(error, "message"))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(ReviewPlatformError::Api(format!(
            "GitHub pull request search failed: {messages}"
        )));
    }
    let invalid =
        || ReviewPlatformError::Parse("Incomplete GitHub pull request search response".into());
    let author = value
        .pointer("/data/viewer/login")
        .and_then(Value::as_str)
        .filter(|login| !login.is_empty())
        .ok_or_else(invalid)?;
    let connection = value
        .pointer("/data/repository/pullRequests")
        .ok_or_else(invalid)?;
    let has_next = connection
        .pointer("/pageInfo/hasNextPage")
        .and_then(Value::as_bool)
        .ok_or_else(invalid)?;
    let items = connection
        .get("edges")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?
        .iter()
        .map(|edge| {
            let cursor = edge
                .get("cursor")
                .and_then(Value::as_str)
                .filter(|cursor| !cursor.is_empty())
                .ok_or_else(invalid)?;
            let node = edge
                .get("node")
                .filter(|node| node.is_object())
                .ok_or_else(invalid)?;
            Ok((
                cursor.to_string(),
                github_pull_request_from_gh_cli_value(node, Some(&ctx.remote.id)),
            ))
        })
        .collect::<Result<VecDeque<_>, ReviewPlatformError>>()?;
    if items.is_empty() && has_next {
        return Err(invalid());
    }
    Ok(CandidatePage {
        progress,
        author: author.to_string(),
        items,
        has_next,
    })
}

fn merge_batch(
    mut pages: Vec<CandidatePage>,
    requested: PullRequestPagination,
    search: &ReviewPlatformListSearch,
) -> list_search::SearchPage {
    let needle = search.query.trim().to_lowercase();
    let mut items = Vec::new();
    for page in &mut pages {
        if page.items.is_empty() && !page.has_next {
            page.progress.exhausted = true;
        }
    }
    loop {
        let newest = pages
            .iter()
            .enumerate()
            .filter_map(|(index, page)| page.items.front().map(|(_, pr)| (index, &pr.updated_at)))
            .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(&left.0)))
            .map(|(index, _)| index);
        let Some(index) = newest else { break };
        let page = &mut pages[index];
        let (cursor, pr) = page.items.pop_front().unwrap();
        page.progress.after = Some(cursor);
        if pr.author.eq_ignore_ascii_case(&page.author)
            && list_search::matches(&pr, ReviewPlatformListState::All, &needle)
        {
            items.push(pr);
        }
        if page.items.is_empty() {
            if page.has_next {
                // The next head of this stream is unknown. Pause here so an
                // older result from another repo cannot precede a newer one.
                break;
            }
            page.progress.exhausted = true;
        }
    }
    let matched_count = search
        .continuation
        .as_ref()
        .map_or(0, |value| value.matched_count)
        + items.len() as u64;
    let has_next = pages.iter().any(|page| !page.progress.exhausted);
    list_search::SearchPage {
        page: ReviewPlatformPullRequestPage {
            items,
            pagination: ReviewPlatformPagination {
                page: 1,
                per_page: requested.per_page,
                total: (!has_next).then_some(matched_count),
                has_next,
            },
        },
        continuation: has_next.then(|| ReviewPlatformSearchContinuation {
            next_page: 1,
            matched_count,
            github_repositories: pages.into_iter().map(|page| page.progress).collect(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(id: &str) -> ProviderContext {
        let mut ctx = provider_context_for_identity(
            ReviewPlatformKind::Github,
            "github.com",
            &format!("example/{id}"),
            &ReviewPlatformAuthTokens::default(),
        )
        .unwrap();
        ctx.remote.id = id.to_string();
        ctx.remote.auth_state = ReviewAuthState::Connected;
        ctx
    }

    fn page(ctx: &ProviderContext, rows: &[(i64, &str, &str)], has_next: bool) -> CandidatePage {
        candidate_page(ctx, ReviewPlatformGithubSearchCursor {
            remote_id: ctx.remote.id.clone(), after: None, exhausted: false,
        }, &json!({
            "data": {
                "viewer": { "login": "me" },
                "repository": { "pullRequests": {
                    "pageInfo": { "hasNextPage": has_next },
                    "edges": rows.iter().map(|(number, updated_at, author)| json!({
                        "cursor": format!("cursor-{number}"),
                        "node": {
                            "number": number, "title": "Needle", "state": "OPEN",
                            "author": { "login": author }, "updatedAt": updated_at,
                            "url": format!("https://github.com/example/{}/pull/{number}", ctx.remote.id),
                            "comments": { "totalCount": 7 },
                            "checkSummary": { "nodes": [{ "commit": { "statusCheckRollup": { "contexts": {
                                "checkRunCountsByState": [{ "state": "SUCCESS", "count": 2 }, { "state": "IN_PROGRESS", "count": 1 }],
                                "statusContextCountsByState": [{ "state": "FAILURE", "count": 1 }]
                            }}}}] }
                        }
                    })).collect::<Vec<_>>()
                }}
            }
        })).unwrap()
    }

    fn query() -> ReviewPlatformListSearch {
        ReviewPlatformListSearch {
            query: "NEEDLE".into(),
            continuation: None,
        }
    }

    #[test]
    fn search_keeps_personal_scope_and_can_continue_past_a_thousand_candidates() {
        let ctx = context("origin");
        let requested = PullRequestPagination::new(Some(1), Some(10));
        let mut search = query();
        // Concurrent repository requests must remain Send for tool dispatch.
        fn assert_send<T: Send>(_: T) {}
        assert_send(search_batch(
            &[ctx.remote.clone()],
            None,
            &ReviewPlatformAuthTokens::default(),
            requested,
            &search,
        ));
        for batch in 0..11 {
            let rows = (1..=100)
                .map(|index| (batch * 100 + index, "2026-10-19", "someone-else"))
                .collect::<Vec<_>>();
            let result = merge_batch(vec![page(&ctx, &rows, true)], requested, &search);
            assert!(result.page.items.is_empty());
            assert_eq!(result.page.pagination.total, None);
            let progress = result.continuation.unwrap();
            assert_eq!(
                progress.github_repositories[0].after,
                Some(format!("cursor-{}", (batch + 1) * 100))
            );
            search.continuation = Some(progress);
        }
        let result = merge_batch(
            vec![page(&ctx, &[(1101, "2026-10-18", "ME")], false)],
            requested,
            &search,
        );
        assert_eq!(result.page.items[0].number, 1101);
        assert_eq!(result.page.items[0].comments, 7);
        assert_eq!(result.page.items[0].checks.total, 4);
        assert_eq!(result.page.items[0].checks.passed, 2);
        assert_eq!(result.page.items[0].checks.failed, 1);
        assert_eq!(result.page.items[0].checks.pending, 1);
        assert_eq!(result.page.pagination.total, Some(1));
        assert!(result.continuation.is_none());
    }

    #[test]
    fn merging_pauses_at_an_unknown_head_and_preserves_other_repository_cursors() {
        let a = context("a");
        let b = context("b");
        let requested = PullRequestPagination::new(Some(1), Some(10));
        let first = merge_batch(
            vec![
                page(&a, &[(5, "05", "me"), (3, "03", "me")], true),
                page(&b, &[(4, "04", "me"), (1, "01", "me")], false),
            ],
            requested,
            &query(),
        );
        assert_eq!(
            first
                .page
                .items
                .iter()
                .map(|pr| pr.number)
                .collect::<Vec<_>>(),
            [5, 4, 3]
        );
        let progress = first.continuation.unwrap();
        assert_eq!(
            progress.github_repositories[0].after.as_deref(),
            Some("cursor-3")
        );
        assert_eq!(
            progress.github_repositories[1].after.as_deref(),
            Some("cursor-4")
        );
        assert!(!progress.github_repositories[1].exhausted);
        let second = merge_batch(
            vec![
                page(&a, &[(2, "02", "me")], false),
                page(&b, &[(1, "01", "me")], false),
            ],
            requested,
            &ReviewPlatformListSearch {
                continuation: Some(progress),
                ..query()
            },
        );
        assert_eq!(
            second
                .page
                .items
                .iter()
                .map(|pr| pr.number)
                .collect::<Vec<_>>(),
            [2, 1]
        );
        assert_eq!(second.page.pagination.total, Some(5));
        assert!(second.continuation.is_none());
    }

    #[test]
    fn workspace_scope_deduplicates_repositories_and_keeps_equal_pr_numbers() {
        let a = context("a");
        let b = context("b");
        let mut alias = a.remote.clone();
        alias.id = "alias".into();
        let remotes = vec![a.remote.clone(), alias, b.remote.clone()];
        let auth = ReviewPlatformAuthTokens::default();
        assert_eq!(search_contexts(&remotes, None, &auth).unwrap().len(), 2);
        assert_eq!(
            search_contexts(&remotes, Some("alias"), &auth).unwrap()[0]
                .remote
                .id,
            "alias"
        );
        let result = merge_batch(
            vec![
                page(&a, &[(42, "02", "me")], false),
                page(&b, &[(42, "01", "me")], false),
            ],
            PullRequestPagination::new(Some(1), Some(10)),
            &query(),
        );
        assert_eq!(result.page.items.len(), 2);
        assert_ne!(result.page.items[0].web_url, result.page.items[1].web_url);
    }

    #[test]
    fn graphql_failures_and_missing_pages_are_not_empty_search_results() {
        let ctx = context("origin");
        let progress = ReviewPlatformGithubSearchCursor {
            remote_id: "origin".into(),
            after: None,
            exhausted: false,
        };
        for response in [
            json!({ "errors": [{ "message": "Timed out" }], "data": {} }),
            json!({ "data": { "viewer": { "login": "me" }, "repository": null } }),
            json!({ "data": { "viewer": { "login": "me" }, "repository": { "pullRequests": {
                "edges": [], "pageInfo": { "hasNextPage": true }
            }}}}),
        ] {
            assert!(candidate_page(&ctx, progress.clone(), &response).is_err());
        }
    }
}
