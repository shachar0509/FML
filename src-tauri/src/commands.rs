use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const SERVICE: &str = "il.shalav.app";
const ACCOUNTS: [&str; 2] = ["anthropic_api_key", "google_refresh_token"];

fn entry(account: &str) -> Result<keyring::Entry, String> {
    if !ACCOUNTS.contains(&account) {
        return Err(format!("unknown secret account: {account}"));
    }
    keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn trash_path(path: String) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// macOS only: converts HEIC to a temp JPEG and returns its path.
#[tauri::command]
pub async fn heic_to_jpeg(src: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(move || {
            let stem = Path::new(&src)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "image".into());
            let out = std::env::temp_dir().join(format!("shalav-{}-{stem}.jpg", std::process::id()));
            let status = std::process::Command::new("sips")
                .args(["-s", "format", "jpeg", &src, "--out"])
                .arg(&out)
                .output()
                .map_err(|e| e.to_string())?;
            if !status.status.success() || !out.exists() {
                return Err(String::from_utf8_lossy(&status.stderr).into_owned());
            }
            Ok(out.to_string_lossy().into_owned())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = src;
        Err("HEIC conversion is not supported on this platform".into())
    }
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[tauri::command]
pub async fn file_sha256(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || sha256_file(Path::new(&path)).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// "name.ext", n=1 -> "name.ext"; n>=2 -> "name  (n).ext" (two spaces, spec 5.2).
fn numbered_name(name: &str, n: u32) -> String {
    if n <= 1 {
        return name.to_string();
    }
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{}  ({n}){}", &name[..i], &name[i..]),
        _ => format!("{name}  ({n})"),
    }
}

fn copy_unique(src: &Path, dest_dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dest_dir)?;
    let name = src
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "source has no file name"))?
        .to_string_lossy()
        .into_owned();
    let mut input = File::open(src)?;
    for n in 1..10_000 {
        let dest = dest_dir.join(numbered_name(&name, n));
        match OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                if let Err(e) = io::copy(&mut input, &mut out) {
                    let _ = fs::remove_file(&dest);
                    return Err(e);
                }
                return Ok(dest);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "too many name collisions"))
}

#[tauri::command]
pub async fn import_copy(src: String, dest_dir: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        copy_unique(Path::new(&src), Path::new(&dest_dir))
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naming() {
        assert_eq!(numbered_name("a.pdf", 1), "a.pdf");
        assert_eq!(numbered_name("a.pdf", 2), "a  (2).pdf");
        assert_eq!(numbered_name("a.b.pdf", 3), "a.b  (3).pdf");
        assert_eq!(numbered_name("noext", 2), "noext  (2)");
        assert_eq!(numbered_name(".hidden", 2), ".hidden  (2)");
    }

    #[test]
    fn sha_and_copy_collisions() {
        let base = std::env::temp_dir().join(format!("shalav-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let src = base.join("f.txt");
        fs::write(&src, b"abc").unwrap();
        assert_eq!(
            sha256_file(&src).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let dest = base.join("out");
        let a = copy_unique(&src, &dest).unwrap();
        let b = copy_unique(&src, &dest).unwrap();
        let c = copy_unique(&src, &dest).unwrap();
        assert_eq!(a.file_name().unwrap(), "f.txt");
        assert_eq!(b.file_name().unwrap(), "f  (2).txt");
        assert_eq!(c.file_name().unwrap(), "f  (3).txt");
        assert_eq!(fs::read(&c).unwrap(), b"abc");
        let _ = fs::remove_dir_all(&base);
    }
}
