use std::{env, fs, path::Path};

fn embed(path: &Path, url: &str, mime: &str, output: &mut String) {
    assert!(
        fs::symlink_metadata(path).unwrap().is_file(),
        "Assets must be regular files"
    );
    println!("cargo:rerun-if-changed={}", path.display());
    output.push_str(&format!(
        "{url:?} => Some(({mime:?}, include_bytes!({:?}))),\n",
        path.canonicalize().unwrap()
    ));
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var_os("CARGO_FEATURE_BUNDLED_FRONTEND").is_none() {
        return;
    }
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/dist");
    assert!(
        dist.join("index.html").is_file(),
        "Run pnpm --filter @agentica/desktop build first"
    );
    println!("cargo:rerun-if-changed={}", dist.display());
    let mut output = String::from(
        "fn frontend_asset(path: &str) -> Option<(&'static str, &'static [u8])> { match path {\n",
    );
    embed(
        &dist.join("index.html"),
        "/",
        "text/html; charset=utf-8",
        &mut output,
    );
    embed(
        &dist.join("index.html"),
        "/index.html",
        "text/html; charset=utf-8",
        &mut output,
    );
    // shortcut: embed current Vite HTML/JS/CSS only; extend the allowlist when the UI adds assets.
    let assets = dist.join("assets");
    assert!(
        fs::symlink_metadata(&assets).unwrap().is_dir(),
        "Assets must be a directory"
    );
    let mut entries: Vec<_> = fs::read_dir(&assets)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        let mime = match path.extension().and_then(|value| value.to_str()) {
            Some("js") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            _ => continue,
        };
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(
            name.bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')),
            "Unsupported asset name"
        );
        embed(&path, &format!("/assets/{name}"), mime, &mut output);
    }
    output.push_str("_ => None, } }\n");
    fs::write(
        Path::new(&env::var_os("OUT_DIR").unwrap()).join("frontend.rs"),
        output,
    )
    .unwrap();
}
