use serde::Serialize;
use std::path::{Component, Path, PathBuf};

const MAX_TREE_ENTRIES: usize = 5_000;
const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    name: String,
    path: String,
    kind: &'static str,
    size: Option<u64>,
    children: Option<Vec<TreeEntry>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    path: String,
    content: String,
    size: u64,
    truncated: bool,
}

fn validate_relative(relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\0') {
        return Err("Path contains a NUL byte".into());
    }
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Path must stay inside the project".into());
    }
    Ok(path.to_path_buf())
}

fn safe_target(root: &str, relative: &str) -> Result<(PathBuf, PathBuf), String> {
    let root =
        std::fs::canonicalize(root).map_err(|error| format!("Invalid project root: {error}"))?;
    if !root.is_dir() {
        return Err("Project root is not a directory".into());
    }
    let relative = validate_relative(relative)?;
    let target = std::fs::canonicalize(root.join(relative))
        .map_err(|error| format!("Path is unavailable: {error}"))?;
    if !target.starts_with(&root) {
        return Err("Path escapes the project root".into());
    }
    Ok((root, target))
}

fn build_tree(
    root: &Path,
    directory: &Path,
    depth: u16,
    count: &mut usize,
) -> Result<Vec<TreeEntry>, String> {
    let mut paths = std::fs::read_dir(directory)
        .map_err(|error| format!("Unable to read directory: {error}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    paths.sort_by_key(|entry| {
        let is_file = entry.file_type().map(|kind| kind.is_file()).unwrap_or(true);
        (is_file, entry.file_name().to_string_lossy().to_lowercase())
    });

    let mut result = Vec::new();
    for entry in paths {
        if *count >= MAX_TREE_ENTRIES {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist") {
            continue;
        }
        let metadata =
            std::fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        *count += 1;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .into_owned();
        if metadata.is_dir() {
            let children = if depth > 0 {
                Some(build_tree(root, &path, depth - 1, count)?)
            } else {
                None
            };
            result.push(TreeEntry {
                name,
                path: relative,
                kind: "directory",
                size: None,
                children,
            });
        } else if metadata.is_file() {
            result.push(TreeEntry {
                name,
                path: relative,
                kind: "file",
                size: Some(metadata.len()),
                children: None,
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn workspace_tree(
    root: String,
    relative: Option<String>,
    depth: Option<u16>,
) -> Result<Vec<TreeEntry>, String> {
    let relative = relative.unwrap_or_default();
    let (canonical_root, target) = safe_target(&root, &relative)?;
    if !target.is_dir() {
        return Err("Requested path is not a directory".into());
    }
    let mut count = 0;
    build_tree(
        &canonical_root,
        &target,
        depth.unwrap_or(3).min(8),
        &mut count,
    )
}

#[tauri::command]
pub fn workspace_read_file(
    root: String,
    relative: String,
    max_bytes: Option<u64>,
) -> Result<FileContent, String> {
    let (_, target) = safe_target(&root, &relative)?;
    let metadata = target.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Requested path is not a file".into());
    }
    let limit = max_bytes.unwrap_or(DEFAULT_MAX_BYTES).min(10 * 1024 * 1024);
    let bytes = std::fs::read(&target).map_err(|error| format!("Unable to read file: {error}"))?;
    let truncated = bytes.len() as u64 > limit;
    let visible = &bytes[..bytes.len().min(limit as usize)];
    let content = String::from_utf8(visible.to_vec())
        .map_err(|_| "Binary files cannot be displayed".to_string())?;
    Ok(FileContent {
        path: relative,
        content,
        size: metadata.len(),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_relative_paths() {
        assert!(validate_relative("src/main.ts").is_ok());
        assert!(validate_relative("../secret").is_err());
        assert!(validate_relative("/etc/passwd").is_err());
    }
}
