//! Repository-wide filtering over provider list pages, before UI pagination.

use super::*;

const SEARCH_BATCH_SIZE: u32 = 100;

pub(super) struct SearchPage {
    pub page: ReviewPlatformPullRequestPage,
    pub continuation: Option<ReviewPlatformSearchContinuation>,
}

pub(super) fn matches(
    pr: &ReviewPlatformPullRequest,
    state: ReviewPlatformListState,
    needle: &str,
) -> bool {
    let state_matches = match state {
        ReviewPlatformListState::All => true,
        ReviewPlatformListState::Open => pr.state == ReviewItemState::Open,
        ReviewPlatformListState::Draft => pr.state == ReviewItemState::Draft,
        ReviewPlatformListState::Merged => pr.state == ReviewItemState::Merged,
        ReviewPlatformListState::Closed => pr.state == ReviewItemState::Closed,
    };
    state_matches
        && [
            pr.title.as_str(),
            pr.author.as_str(),
            pr.source_branch.as_str(),
            pr.target_branch.as_str(),
            &format!("#{}", pr.number),
        ]
        .iter()
        .any(|value| value.to_lowercase().contains(needle))
}

pub(super) async fn search_page(
    provider: &dyn ReviewProvider,
    ctx: &ProviderContext,
    requested: PullRequestPagination,
    state: ReviewPlatformListState,
    search: &ReviewPlatformListSearch,
) -> Result<SearchPage, ReviewPlatformError> {
    let source_page = search
        .continuation
        .as_ref()
        .map_or(1, |value| value.next_page);
    let mut matched_count = search
        .continuation
        .as_ref()
        .map_or(0, |value| value.matched_count);
    let incoming = provider
        .list_search_candidates(
            ctx,
            PullRequestPagination {
                page: source_page,
                per_page: SEARCH_BATCH_SIZE,
            },
        )
        .await?;
    if incoming.items.is_empty() && incoming.pagination.has_next {
        return Err(ReviewPlatformError::Parse(
            "Provider returned an empty pull request page with more results pending".into(),
        ));
    }

    let end = u64::from(requested.page) * u64::from(requested.per_page);
    let start = end - u64::from(requested.per_page);
    let needle = search.query.trim().to_lowercase();
    let mut items = Vec::new();
    for pr in incoming.items {
        if matches(&pr, state, &needle) {
            matched_count += 1;
            if matched_count > start && matched_count <= end {
                items.push(pr);
            }
        }
    }
    let complete = !incoming.pagination.has_next;
    let has_next = matched_count > end;
    let continuation = (!complete && !has_next).then_some(ReviewPlatformSearchContinuation {
        next_page: source_page + 1,
        matched_count,
        github_repositories: Vec::new(),
    });
    // Only these rows can appear on the requested result page. Candidate scans
    // never load file lists for the other pull requests in the repository.
    let items = provider.enrich_pull_request_list(ctx, items).await;
    Ok(SearchPage {
        page: ReviewPlatformPullRequestPage {
            items,
            pagination: ReviewPlatformPagination {
                page: requested.page,
                per_page: requested.per_page,
                total: complete.then_some(matched_count),
                has_next,
            },
        },
        continuation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Candidates {
        items: Vec<ReviewPlatformPullRequest>,
        has_next: bool,
    }

    #[async_trait::async_trait]
    impl ReviewProvider for Candidates {
        async fn list_search_candidates(
            &self,
            _ctx: &ProviderContext,
            _pagination: PullRequestPagination,
        ) -> Result<ReviewPlatformPullRequestPage, ReviewPlatformError> {
            Ok(ReviewPlatformPullRequestPage {
                items: self.items.clone(),
                pagination: ReviewPlatformPagination {
                    page: 1,
                    per_page: 100,
                    total: None,
                    has_next: self.has_next,
                },
            })
        }

        async fn list_pull_requests(
            &self,
            _ctx: &ProviderContext,
            _pagination: PullRequestPagination,
        ) -> Result<ReviewPlatformPullRequestPage, ReviewPlatformError> {
            unreachable!("search must use candidate pages without list enrichment")
        }

        async fn pull_request_detail(
            &self,
            _ctx: &ProviderContext,
            _id: &str,
        ) -> Result<ReviewPlatformPullRequestDetail, ReviewPlatformError> {
            unreachable!("search does not fetch review details")
        }
    }

    fn pr(number: i64) -> ReviewPlatformPullRequest {
        github_pull_request_from_value(&json!({ "number": number, "title": "needle" }))
    }

    fn context() -> ProviderContext {
        provider_context_for_identity(
            ReviewPlatformKind::Gitcode,
            "gitcode.com",
            "example/repo",
            &ReviewPlatformAuthTokens::default(),
        )
        .unwrap()
    }

    #[test]
    fn keyword_matching_preserves_existing_fields_and_combined_state() {
        let mut value = pr(123);
        value.title = "Fix title".into();
        value.author = "AnAuthor".into();
        value.source_branch = "feature/Search".into();
        value.target_branch = "release/Main".into();
        for query in ["fix", "author", "feature/search", "release/main", "#12"] {
            assert!(matches(&value, ReviewPlatformListState::All, query));
        }
        assert!(!matches(&value, ReviewPlatformListState::Merged, "fix"));
        value.state = ReviewItemState::Merged;
        assert!(matches(&value, ReviewPlatformListState::Merged, "fix"));
    }

    #[tokio::test]
    async fn lookahead_finishes_a_result_page_without_scanning_the_tail_or_faking_a_total() {
        let provider = Candidates {
            items: (1..=5).map(pr).collect(),
            has_next: true,
        };
        let result = search_page(
            &provider,
            &context(),
            PullRequestPagination {
                page: 2,
                per_page: 2,
            },
            ReviewPlatformListState::All,
            &ReviewPlatformListSearch {
                query: "needle".into(),
                continuation: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            result
                .page
                .items
                .iter()
                .map(|pr| pr.number)
                .collect::<Vec<_>>(),
            [3, 4]
        );
        assert!(result.page.pagination.has_next);
        assert_eq!(result.page.pagination.total, None);
        assert!(result.continuation.is_none());
    }

    #[tokio::test]
    async fn search_can_continue_beyond_the_review_evidence_page_budget() {
        let provider = Candidates {
            items: vec![pr(1001)],
            has_next: false,
        };
        let result = search_page(
            &provider,
            &context(),
            PullRequestPagination {
                page: 1,
                per_page: 10,
            },
            ReviewPlatformListState::All,
            &ReviewPlatformListSearch {
                query: "needle".into(),
                continuation: Some(ReviewPlatformSearchContinuation {
                    next_page: 11,
                    matched_count: 0,
                    github_repositories: Vec::new(),
                }),
            },
        )
        .await
        .unwrap();
        assert_eq!(result.page.items[0].number, 1001);
        assert_eq!(result.page.pagination.total, Some(1));
        assert!(result.continuation.is_none());
    }

    #[tokio::test]
    async fn incomplete_empty_source_pages_fail_instead_of_reporting_no_matches() {
        let provider = Candidates {
            items: vec![],
            has_next: true,
        };
        assert!(matches!(
            search_page(
                &provider,
                &context(),
                PullRequestPagination {
                    page: 1,
                    per_page: 10
                },
                ReviewPlatformListState::All,
                &ReviewPlatformListSearch {
                    query: "needle".into(),
                    continuation: None
                }
            )
            .await,
            Err(ReviewPlatformError::Parse(_))
        ));
    }

    #[test]
    fn older_snapshots_and_search_requests_remain_readable() {
        let mut value = serde_json::to_value(empty_snapshot(vec![], None, None, "")).unwrap();
        value["capabilities"]
            .as_object_mut()
            .unwrap()
            .remove("supportsPullRequestSearch");
        value.as_object_mut().unwrap().remove("searchContinuation");
        let decoded: ReviewPlatformWorkspaceSnapshot =
            serde_json::from_value(value.clone()).unwrap();
        assert!(decoded.search_continuation.is_none());
        assert!(!decoded.capabilities.supports_pull_request_search);
        assert_eq!(serde_json::to_value(decoded).unwrap(), value);
        let decoded: ReviewPlatformListSearch =
            serde_json::from_value(json!({ "query": "fix" })).unwrap();
        assert!(decoded.continuation.is_none());
    }
}
