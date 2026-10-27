//! Reads and writes the real game's Unity PlayerPrefs `EQUIPPED_ITEMS_3`, so
//! our client and the game share the equipped outfit.
//!
//! The value is a JSON array of `[hat, skin]` pairs, -1 = none. The game repeats
//! the same pair; we keep however many it has.

const KEY: &str = "EQUIPPED_ITEMS_3";

/// The game's equipped (hat, skin), -1 = none. None when the game has never stored one.
pub fn outfit() -> Option<(i64, i64)> {
    first_pair(&read(KEY)?)
}

/// Stores (hat, skin) for the game, in every pair it already has (3 when none yet).
pub fn set_outfit(hat: i64, skin: i64) -> Result<(), String> {
    let pairs = read(KEY)
        .and_then(|s| serde_json::from_str::<Vec<i64>>(&s).ok())
        .map_or(3, |v| (v.len() / 2).max(1));
    write(KEY, &format(hat, skin, pairs))
}

fn first_pair(s: &str) -> Option<(i64, i64)> {
    match serde_json::from_str::<Vec<i64>>(s.trim()).ok()?[..] {
        [h, k, ..] => Some((h, k)),
        _ => None,
    }
}

fn format(hat: i64, skin: i64, pairs: usize) -> String {
    let p = format!("{hat},{skin}");
    format!("[{}]", vec![p; pairs].join(","))
}

#[cfg(target_os = "macos")]
const DOMAIN: &str = "com.Irox-Games.BongoCat";

#[cfg(target_os = "macos")]
fn read(key: &str) -> Option<String> {
    let out = std::process::Command::new("defaults").args(["read", DOMAIN, key]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn write(key: &str, value: &str) -> Result<(), String> {
    let st = std::process::Command::new("defaults")
        .args(["write", DOMAIN, key, "-string", value])
        .status()
        .map_err(|e| e.to_string())?;
    st.success().then_some(()).ok_or_else(|| format!("defaults write: {st}"))
}

#[cfg(target_os = "windows")]
const REG: &str = r"HKCU\Software\Irox Games\BongoCat";

/// Unity's PlayerPrefs value name: `<key>_h<djb2-xor hash of key>`.
#[cfg(any(target_os = "windows", test))]
fn hash(key: &str) -> u32 {
    key.bytes().fold(5381u32, |h, b| h.wrapping_mul(33) ^ b as u32)
}

#[cfg(target_os = "windows")]
fn reg(args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("reg")
        .args(args)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!("reg: {}", out.status))
    }
}

#[cfg(target_os = "windows")]
fn read(key: &str) -> Option<String> {
    let name = format!("{key}_h{}", hash(key));
    let out = reg(&["query", REG, "/v", &name]).ok()?;
    let hex = out.lines().find(|l| l.contains("REG_BINARY"))?.split_whitespace().last()?;
    let mut bytes = (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    bytes.pop_if(|b| *b == 0);
    String::from_utf8(bytes).ok()
}

#[cfg(target_os = "windows")]
fn write(key: &str, value: &str) -> Result<(), String> {
    let name = format!("{key}_h{}", hash(key));
    let hex: String = value.bytes().chain([0]).map(|b| format!("{b:02X}")).collect();
    reg(&["add", REG, "/v", &name, "/t", "REG_BINARY", "/d", &hex, "/f"]).map(|_| ())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn read(_key: &str) -> Option<String> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write(_key: &str, _value: &str) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_format() {
        assert_eq!(first_pair("[267,416,1,2]\n"), Some((267, 416)));
        assert_eq!(first_pair("[1]"), None);
        assert_eq!(first_pair("nope"), None);
        assert_eq!(format(267, 416, 3), "[267,416,267,416,267,416]");
        assert_eq!(format(-1, -1, 1), "[-1,-1]");
    }

    #[test]
    fn hash_is_djb2_xor() {
        assert_eq!(hash(""), 5381);
        assert_eq!(hash("a"), 5381u32.wrapping_mul(33) ^ 97);
    }
}
