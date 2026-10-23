use std::{env, fs, path::PathBuf};

fn main() {
    copy_steam_lib();
    tauri_build::build()
}

/// The binary loads the Steam runtime library from next to itself, but steamworks-sys
/// doesn't put it there. Copy the one shipped in the steamworks-sys sources (version
/// taken from Cargo.lock) to target/<profile>/, also the macOS bundle's source.
fn copy_steam_lib() {
    let (dir, name) = match env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
        "macos" => ("osx", "libsteam_api.dylib"),
        "linux" => ("linux64", "libsteam_api.so"),
        "windows" => ("win64", "steam_api64.dll"),
        _ => return,
    };
    let lock = fs::read_to_string("Cargo.lock").unwrap();
    let version = lock
        .split("name = \"steamworks-sys\"\nversion = \"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .expect("steamworks-sys missing from Cargo.lock");
    let cargo_home = env::var("CARGO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env::var("HOME").unwrap()).join(".cargo"));
    let src = fs::read_dir(cargo_home.join("registry/src"))
        .unwrap()
        .flatten()
        .map(|reg| {
            reg.path()
                .join(format!("steamworks-sys-{version}/lib/steam/redistributable_bin/{dir}/{name}"))
        })
        .find(|p| p.exists())
        .expect("steamworks-sys sources not found");
    // OUT_DIR = target/<profile>/build/<crate>-<hash>/out
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::copy(&src, out.ancestors().nth(3).unwrap().join(name)).unwrap();
    println!("cargo:rerun-if-changed=Cargo.lock");
}
