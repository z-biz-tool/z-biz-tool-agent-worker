// Manages the local `agent-proxy` Node.js service as a Tauri-managed child
// process. The service binds to 127.0.0.1:9099 and bridges the desktop UI to
// local Claude Code / Hermes / OpenCode CLIs.
//
// Lifecycle:
//   - spawned during `setup` (right after the Tauri app is built)
//   - killed on `RunEvent::Exit` (covers window close + OS-driven quit)
//
// We deliberately do NOT use `tauri-plugin-shell` here — we want the child
// fully owned by us (kill on drop, port collision detection) rather than
// spawned on demand by the frontend.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

pub struct AgentProxyHandle(pub Mutex<Option<Child>>);

/// Default listen port — keep in sync with `agent-proxy/src/config.ts`.
const DEFAULT_PORT: u16 = 9099;

pub fn spawn() -> Result<Child, String> {
    if is_port_in_use(DEFAULT_PORT) {
        return Err(format!(
            "port {} is already in use; another agent-proxy may be running",
            DEFAULT_PORT
        ));
    }

    let node = resolve_node().ok_or_else(|| "node executable not found in PATH".to_string())?;
    let entry = resolve_entry()
        .ok_or_else(|| "agent-proxy dist not built; run `npm run build` in agent-proxy/ first".to_string())?;

    eprintln!("[agent-proxy] launching: {} {}", node.display(), entry.display());

    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .env("AGENT_PROXY_AUTOSTART", "1")
        .current_dir(entry.parent().unwrap_or_else(|| std::path::Path::new(".")))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn agent-proxy: {}", e))?;

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || pipe_to_stderr("agent-proxy/stdout", stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || pipe_to_stderr("agent-proxy/stderr", stderr));
    }

    // Give it a moment to bind, then double-check the port.
    std::thread::sleep(std::time::Duration::from_millis(400));
    if !is_port_in_use(DEFAULT_PORT) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "agent-proxy exited before binding port {} (see logs above)",
            DEFAULT_PORT
        ));
    }
    eprintln!("[agent-proxy] ready on http://127.0.0.1:{}", DEFAULT_PORT);
    Ok(child)
}

/// Kill and reap a child process. Safe to call multiple times.
pub fn kill(child: &mut Child) {
    let _ = child.kill();
    // Wait so the OS reaps the process; otherwise we may leak a zombie
    // briefly. We swallow errors because the child may have exited already.
    let _ = child.wait();
}

// ──────────── helpers ────────────

fn pipe_to_stderr(prefix: &str, stream: impl Read + Send + 'static) {
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        eprintln!("[{}] {}", prefix, line);
    }
}

fn is_port_in_use(port: u16) -> bool {
    use std::net::TcpStream;
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok()
}

fn resolve_node() -> Option<PathBuf> {
    // 1. `which node` — works if PATH includes the user's node install
    //    (e.g. homebrew in /opt/homebrew/bin which is in default macOS PATH).
    if let Ok(out) = Command::new("which").arg("node").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }

    // 2. Scan common install locations. macOS .app processes inherit a
    //    minimal PATH that usually excludes nvm-managed bins, so we
    //    look in the obvious spots directly.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates: [PathBuf; 8] = [
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
        PathBuf::from("/bin/node"),
        PathBuf::from(home.clone() + "/.local/bin/node"),
        PathBuf::from(home.clone() + "/.nvm/versions/node"),
        // last-resort: maybe node is sitting on the Desktop or something;
        // skip — the scan below handles nvm versions.
        PathBuf::new(),
        PathBuf::new(),
    ];
    for c in candidates.iter() {
        if c.as_os_str().is_empty() {
            continue;
        }
        if c.is_file() {
            return Some(c.clone());
        }
    }

    // 3. nvm version dir — pick the highest version
    let nvm_root = PathBuf::from(home + "/.nvm/versions/node");
    if nvm_root.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = rd
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            // Sort descending by version string (rough — works for semver-ish).
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            for v in versions {
                let p = v.join("bin").join("node");
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    // 4. Last resort: bare name, let the OS resolve via PATH.
    Some(PathBuf::from("node"))
}

fn resolve_entry() -> Option<PathBuf> {
    // 1. Production: alongside the executable. On macOS .app bundles the
    //    Tauri `resources` map lands under Contents/Resources/, while on
    //    Windows / Linux the bundle is laid out next to the .exe / binary.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // 1a. macOS .app: <Contents>/Resources/agent-proxy/dist/index.js
            if let Some(contents_dir) = dir.parent() {
                let p = contents_dir
                    .join("Resources")
                    .join("agent-proxy")
                    .join("dist")
                    .join("index.js");
                if p.exists() {
                    return Some(p);
                }
            }
            // 1b. Windows / Linux: alongside the binary
            let p = dir.join("agent-proxy").join("dist").join("index.js");
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Dev: <workspace>/agent-proxy/dist/index.js — search upwards from
    //    CARGO_MANIFEST_DIR (src-tauri/) until we find a sibling agent-proxy.
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let mut cur = PathBuf::from(&manifest);
        for _ in 0..5 {
            let candidate = cur.join("agent-proxy").join("dist").join("index.js");
            if candidate.exists() {
                return Some(candidate);
            }
            if !cur.pop() {
                break;
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// End-to-end check: spawn → port bound → kill → port released.
    /// Skipped if the dist isn't built or `node` isn't on PATH.
    #[test]
    fn spawn_and_kill_lifecycle() {
        if resolve_node().is_none() {
            eprintln!("skipping: node not in PATH");
            return;
        }
        if resolve_entry().is_none() {
            eprintln!("skipping: agent-proxy/dist/index.js not built");
            return;
        }
        if is_port_in_use(DEFAULT_PORT) {
            eprintln!("skipping: port {} already in use", DEFAULT_PORT);
            return;
        }

        let mut child = spawn().expect("spawn");
        assert!(is_port_in_use(DEFAULT_PORT), "port should be bound after spawn");

        kill(&mut child);
        // Give the OS a moment to release the port.
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            !is_port_in_use(DEFAULT_PORT),
            "port should be released after kill"
        );
    }
}
