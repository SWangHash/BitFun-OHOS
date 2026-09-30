// Compile and test production Linux providers and the real control-resource owner.
// GTK/portal integration tests are ignored unless explicitly selected; no native API is mocked.
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (process.platform !== 'linux') {
  throw new Error('This harness requires Linux and the GStreamer development packages.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'bitfun-linux-native-'));
const source = (path) => JSON.stringify(resolve(root, path));
try {
  // Extract the actual lease trait rather than maintaining a replacement contract.
  const host = await readFile(join(root, 'src/crates/assembly/core/src/agentic/tools/computer_use_host.rs'), 'utf8');
  const lease = host.match(/pub trait ComputerUseActionLease:[\s\S]*?\n\}/)?.[0];
  if (!lease) throw new Error('The production lease trait could not be extracted.');
  await writeFile(join(dir, 'Cargo.toml'), `[package]
name = "linux-computer-use-native-tests"
version = "0.0.0"
edition = "2021"
[workspace]
[lib]
path = "lib.rs"
[dependencies]
atspi = { version = "0.29", features = ["zbus"] }
gstreamer = { version = "0.24", default-features = false }
gstreamer-app = { version = "0.24", default-features = false }
futures = "0.3"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha1 = "0.10"
screenshots = "0.8"
base64 = "0.22"
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
`);
  await copyFile(join(root, 'Cargo.lock'), join(dir, 'Cargo.lock'));
  await writeFile(join(dir, 'lib.rs'), `#![allow(dead_code, unused_imports)]
extern crate self as bitfun_core;
extern crate self as bitfun_agent_tools;
#[path = ${source('src/crates/execution/tool-contracts/src/computer_use.rs')}]
pub mod computer_use_contract;
#[path = ${source('src/crates/execution/tool-contracts/src/computer_use_control.rs')}]
pub mod computer_use_control;
pub mod agentic { pub mod tools { pub mod computer_use_host {
    pub use crate::computer_use_contract::*;
    ${lease}
}}}
pub mod util { pub mod errors {
    pub use crate::computer_use_contract::{ComputerUseContractError as BitFunError, ComputerUseContractResult as BitFunResult};
}}
#[path = ${source('src/apps/desktop/src/computer_use/control_session.rs')}]
mod control_session;
#[path = ${source('src/apps/desktop/src/computer_use/linux_control.rs')}]
mod linux_control;
#[path = ${source('src/apps/desktop/src/computer_use/linux_control_ax.rs')}]
mod linux_control_ax;
#[path = ${source('src/apps/desktop/src/computer_use/linux_ax_ui.rs')}]
mod linux_ax_ui;
#[path = ${source('src/apps/desktop/src/computer_use/ui_locate_common.rs')}]
mod ui_locate_common;
#[path = ${source('src/apps/desktop/src/computer_use/ax_snapshot_digest.rs')}]
mod ax_snapshot_digest;
`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn('cargo', ['test', '--offline', '--manifest-path', join(dir, 'Cargo.toml'), '--lib', ...process.argv.slice(2)], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(root, 'target/linux-computer-use-native') },
    });
    child.on('error', reject);
    child.on('close', (code) => resolveExit(code ?? 1));
  });
  process.exitCode = code;
} finally {
  await rm(dir, { recursive: true, force: true });
}
