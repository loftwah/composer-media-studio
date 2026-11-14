//! A bounded, explicitly local media selection. Never accepts a URL or uploads.
use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 256 * 1024 * 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Video,
    Audio,
}
#[derive(Debug)]
pub struct LocalMedia {
    pub path: PathBuf,
    pub name: String,
    pub kind: Kind,
}

pub fn inspect(path: &Path) -> Result<LocalMedia, &'static str> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("Local audio and video review is not supported on this platform yet.");
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match ext.as_str() {
        "mp4" | "mov" | "m4v" => Kind::Video,
        "mp3" | "m4a" | "wav" => Kind::Audio,
        _ => return Err("Choose one MP4, MOV, M4V, MP3, M4A or WAV file."),
    };
    let metadata = std::fs::metadata(path).map_err(|_| "The selected file is unavailable.")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BYTES {
        return Err("Choose a non-empty file no larger than 256 MiB.");
    }
    let name = path
        .file_name()
        .ok_or("The selected file has no name.")?
        .to_string_lossy()
        .into_owned();
    Ok(LocalMedia {
        path: path.to_owned(),
        name,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsupported_or_missing_files_without_network() {
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(inspect(Path::new("fictional.txt")).is_err());
            assert!(inspect(Path::new("missing.mp4")).is_err());
        } else {
            assert!(
                inspect(Path::new("missing.mp4"))
                    .unwrap_err()
                    .contains("not supported")
            );
        }
    }
}
