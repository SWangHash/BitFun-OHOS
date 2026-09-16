//! Stable directory ordering shared by local and remote host adapters, before pagination.
use super::FileTreeNode;
use std::cmp::Ordering;

pub fn sort_directory_nodes(
    nodes: &mut [FileTreeNode],
    sort_by: Option<&str>,
    sort_order: Option<&str>,
) -> Result<(), String> {
    let Some(sort_by) = sort_by else {
        return Ok(());
    };
    if !matches!(sort_by, "name" | "modified") {
        return Err(format!("Unsupported directory sort field: {sort_by}"));
    }
    let descending = match sort_order.unwrap_or("asc") {
        "asc" => false,
        "desc" => true,
        order => return Err(format!("Unsupported directory sort order: {order}")),
    };
    fn modified(value: &Option<String>) -> Option<i64> {
        let value = value.as_deref()?;
        chrono::DateTime::parse_from_rfc3339(value)
            .map(|time| time.timestamp())
            .ok()
            .or_else(|| {
                chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                    .ok()
                    .map(|time| time.and_utc().timestamp())
            })
    }
    nodes.sort_by(|a, b| {
        let kind = b.is_directory.cmp(&a.is_directory);
        if kind != Ordering::Equal {
            return kind;
        }
        let order = if sort_by == "modified" {
            match (modified(&a.last_modified), modified(&b.last_modified)) {
                (Some(a), Some(b)) => {
                    if descending {
                        b.cmp(&a)
                    } else {
                        a.cmp(&b)
                    }
                }
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            }
        } else {
            let order = a.name.to_lowercase().cmp(&b.name.to_lowercase());
            if descending {
                order.reverse()
            } else {
                order
            }
        };
        order
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(name: &str, directory: bool, modified: &str) -> FileTreeNode {
        FileTreeNode::new(name.into(), name.into(), name.into(), directory)
            .with_metadata(None, Some(modified.into()))
    }
    #[test]
    fn ordering_precedes_pages_and_keeps_directories_first() {
        let mut nodes = vec![
            entry("z", false, "2026-01-01 00:00:00"),
            entry("B", true, "2025-01-01 00:00:00"),
            entry("a", false, "2026-01-02T00:00:00Z"),
        ];
        sort_directory_nodes(&mut nodes, Some("name"), Some("asc")).unwrap();
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["B", "a", "z"]
        );
        sort_directory_nodes(&mut nodes, Some("modified"), Some("desc")).unwrap();
        assert_eq!(
            nodes
                .iter()
                .skip(1)
                .take(1)
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["a"]
        );
        sort_directory_nodes(&mut nodes, Some("name"), Some("desc")).unwrap();
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["B", "z", "a"]
        );
    }
}
