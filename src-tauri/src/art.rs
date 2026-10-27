//! Copies the default cat sprites out of a locally installed copy of the game.
//!
//! Each sprite is its own 256x256 RGBA32 Texture2D whose pixels live in
//! `sharedassets0.assets.resS`, so all we need from the Unity file is the
//! object table, each texture's name and the offset of its pixel data.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// (texture name in the game, file name we write). The game ships bongo sprites
/// too, but never shows them, so neither do we.
pub const SPRITES: [(&str, &str); 4] = [
    ("CatLeft", "catLeft"),
    ("CatLeftPunch", "catLeftPunch"),
    ("CatRight", "catRight"),
    ("CatRightPunch", "catRightPunch"),
];

const SIZE: u32 = 256;
const BYTES: u32 = SIZE * SIZE * 4;
const TEXTURE_2D: i32 = 28;
const ASSETS: &str = "sharedassets0.assets";

/// Returns the folder with all sprites, extracting them first if they are missing.
pub fn ensure(app_data: &Path, install_dir: Option<&str>) -> Option<PathBuf> {
    let art = app_data.join("art");
    if SPRITES.iter().all(|(_, n)| art.join(format!("{n}.png")).exists()) {
        return Some(art);
    }
    let data = data_dir(Path::new(install_dir?))?;
    // Extract into a temp folder and swap it in, so a crash never leaves half a set.
    let tmp = app_data.join("art.tmp");
    let _ = fs::remove_dir_all(&tmp);
    let _ = fs::remove_dir_all(&art);
    match extract(&data, &tmp).and_then(|_| fs::rename(&tmp, &art)) {
        Ok(()) => Some(art),
        Err(e) => {
            log::warn!("art extraction failed, using placeholder: {e}");
            let _ = fs::remove_dir_all(&tmp);
            None
        }
    }
}

/// The game's Unity data folder (macOS app bundle, or `<name>_Data` on Windows/Linux).
fn data_dir(install: &Path) -> Option<PathBuf> {
    [
        install.join("BongoCat.app/Contents/Resources/Data"),
        install.join("BongoCat_Data"),
    ]
    .into_iter()
    .find(|d| d.join(ASSETS).exists())
}

fn extract(data: &Path, out: &Path) -> io::Result<()> {
    let assets = fs::read(data.join(ASSETS))?;
    let mut res = File::open(data.join(format!("{ASSETS}.resS")))?;
    let found = find_textures(&assets)?;
    fs::create_dir_all(out)?;
    for (name, file) in SPRITES {
        let &(_, offset) = found
            .iter()
            .find(|(n, _)| n == name)
            .ok_or_else(|| bad(&format!("texture {name} not found")))?;
        let mut px = vec![0u8; BYTES as usize];
        res.seek(SeekFrom::Start(offset))?;
        res.read_exact(&mut px)?;
        // Unity stores rows bottom-up.
        let row = (SIZE * 4) as usize;
        let flipped: Vec<u8> = px.chunks_exact(row).rev().flatten().copied().collect();
        let mut enc = png::Encoder::new(File::create(out.join(format!("{file}.png")))?, SIZE, SIZE);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()?.write_image_data(&flipped)?;
    }
    Ok(())
}

/// Name and `.resS` offset of every wanted 256x256 RGBA32 texture in a
/// format-22 serialized file without type trees (what the game ships).
fn find_textures(f: &[u8]) -> io::Result<Vec<(String, u64)>> {
    let be32 = |o: usize| -> io::Result<u32> { Ok(u32::from_be_bytes(get(f, o)?)) };
    let be64 = |o: usize| -> io::Result<u64> { Ok(u64::from_be_bytes(get(f, o)?)) };
    if be32(8)? != 22 {
        return Err(bad("unsupported unity file version"));
    }
    if f.get(16) != Some(&0) {
        return Err(bad("big-endian unity file"));
    }
    let data_offset = be64(32)? as usize;

    let mut r = Reader { f, pos: 48 };
    while r.u8()? != 0 {} // unity version string
    r.skip(4)?; // target platform
    if r.u8()? != 0 {
        return Err(bad("type trees present, layout unknown"));
    }
    let mut classes = Vec::new();
    for _ in 0..r.i32()? {
        let class = r.i32()?;
        r.skip(1 + 2)?; // stripped flag, script type index
        r.skip(if class == 114 { 32 } else { 16 })?; // (script id +) type hash
        classes.push(class);
    }

    let res_name = format!("{ASSETS}.resS");
    let mut out = Vec::new();
    for _ in 0..r.i32()? {
        r.pos = r.pos.next_multiple_of(4);
        r.skip(8)?; // path id
        let start = data_offset + r.i64()? as usize;
        let len = r.u32()? as usize;
        let class = classes.get(r.i32()? as usize).copied();
        if class != Some(TEXTURE_2D) {
            continue;
        }
        let obj = f.get(start..start + len).ok_or_else(|| bad("object out of range"))?;
        let name_len = u32::from_le_bytes(get(obj, 0)?) as usize;
        let Some(name) = obj.get(4..4 + name_len).and_then(|n| std::str::from_utf8(n).ok()) else {
            continue;
        };
        if !SPRITES.iter().any(|(n, _)| *n == name) {
            continue;
        }
        if !is_rgba32_256(obj) {
            return Err(bad(&format!("texture {name} is not 256x256 RGBA32")));
        }
        // m_StreamData ends the object: offset u64, size u32, path string.
        let p = find(obj, res_name.as_bytes())
            .filter(|&p| p >= 16)
            .ok_or_else(|| bad("stream path not found"))?;
        let size = u32::from_le_bytes(get(obj, p - 8)?);
        if u32::from_le_bytes(get(obj, p - 4)?) as usize != res_name.len() || size != BYTES {
            return Err(bad(&format!("unexpected stream data for {name}")));
        }
        out.push((name.to_string(), u64::from_le_bytes(get(obj, p - 16)?)));
    }
    Ok(out)
}

/// Looks for width, height, image size, mip-stripped, format = 256, 256, 262144, _, 4.
fn is_rgba32_256(obj: &[u8]) -> bool {
    let w: Vec<u32> = obj.as_chunks::<4>().0.iter().map(|c| u32::from_le_bytes(*c)).collect();
    w.windows(5).any(|v| v[0] == SIZE && v[1] == SIZE && v[2] == BYTES && v[4] == 4)
}

struct Reader<'a> {
    f: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> io::Result<[u8; N]> {
        let v = get(self.f, self.pos)?;
        self.pos += N;
        Ok(v)
    }
    fn skip(&mut self, n: usize) -> io::Result<()> {
        self.pos += n;
        (self.pos <= self.f.len()).then_some(()).ok_or_else(|| bad("unexpected end of file"))
    }
    fn u8(&mut self) -> io::Result<u8> {
        Ok(self.take::<1>()?[0])
    }
    fn i32(&mut self) -> io::Result<i32> {
        Ok(i32::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> io::Result<u32> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> io::Result<i64> {
        Ok(i64::from_le_bytes(self.take()?))
    }
}

fn get<const N: usize>(f: &[u8], o: usize) -> io::Result<[u8; N]> {
    f.get(o..o + N)
        .map(|s| s.try_into().unwrap())
        .ok_or_else(|| bad("unexpected end of file"))
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn bad(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

#[cfg(test)]
mod tests {
    /// Runs against the real game when it is installed in the default Steam library.
    #[test]
    fn extracts_from_installed_game() {
        let home = std::env::var("HOME").unwrap();
        let install = format!("{home}/Library/Application Support/Steam/steamapps/common/BongoCat");
        let Some(data) = super::data_dir(install.as_ref()) else {
            eprintln!("game not installed, skipping");
            return;
        };
        let out = std::env::temp_dir().join("bongocatbuddy-art-test");
        let _ = std::fs::remove_dir_all(&out);
        super::extract(&data, &out).unwrap();
        for (_, file) in super::SPRITES {
            assert!(out.join(format!("{file}.png")).exists(), "{file} missing");
        }
    }
}
