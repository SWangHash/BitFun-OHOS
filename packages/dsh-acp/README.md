# @bitfun/dsh-acp

An Agent Client Protocol server for [DeepSeek Harness](https://github.com/deepseek-ai)
(`dsh`), written for an IDE rather than for automation.

This bridge targets the older harness APIs and provides IDE-oriented session,
tool, reasoning, and mode integration. Recent harness releases include their
own ACP profile; the HarmonyOS built-in client prefers that profile when its
transport is available, avoiding a bridge/runtime API mismatch.

## For users

Three steps, and BitFun stores none of your DeepSeek configuration:

1. Install the harness — `npm install -g @deepseek-ai/dsh` (BitFun's agent
   settings page has a one-click button that runs the same thing). It is a Node
   program and needs **Node 20.12 or newer** — its own toolchain targets Node 22
   LTS. dsh declares no `engines`, so npm installs it onto an older Node without
   complaint and it then fails to boot with a `SyntaxError` about
   `util.parseEnv`; BitFun checks the version up front and says so instead.
2. Configure a model and an API key inside dsh, e.g. through `dsh web`'s Models
   page. That writes `~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml`.
3. Pick **DeepSeek Harness** in BitFun and start a session.

The model and the key stay where you put them. This bridge reads them through
the harness's own `dsh-settings-file`, `dsh-credentials-local`, and
`dsh-agent-default-model` services, so switching models in dsh switches them in
BitFun too. BitFun writes no DeepSeek credentials of its own.

A session also opens with a model picker of its own: the bridge publishes every
model your dsh providers advertise as the `model` session config option,
grouped by provider, starting on the default above. Picking one applies from
the next message and lasts that session — it does not rewrite your dsh default.

## How BitFun launches it

The bundled fallback runs `dsh --profile bitfun-acp`. A dsh profile is a directory under
`$DSH_HOME/profiles/`, and BitFun materializes this one on first use — see
`src/crates/interfaces/acp/src/client/dsh_profile.rs`.

```
$DSH_HOME/profiles/bitfun-acp/
  package.json            dsh.profile.bundles: []  — an empty root, so the
                          harness's default tool rows cannot leak into a
                          preset that asked to be minimal
  cordis.patch.yml        generated from cordis.yml; the whole file as one
                          `insert:` layer over that empty root
  lib/**                  the compiled bridge
  presets/**              the modes the session offers
  node_modules/           only what the harness closure does NOT already carry
  .bitfun-bridge.json     build stamp; BitFun re-syncs when it changes
```

Everything else resolves out of the user's own dsh: on every launch the harness
symlinks its entire dependency closure into `$DSH_HOME/profiles/node_modules`,
which ordinary Node parent-directory lookup finds from inside the profile. That
is why this package vendors almost nothing and never installs a second copy of
the harness.

A remote workspace works the same way: BitFun packs the profile above into a tar
stream and extracts it into `$DSH_HOME/profiles/bitfun-acp/` on that host over
the session's own transport — no SFTP, so container connections are covered too
— and skips the upload when the stamp there already matches. `dsh` itself, the
models, and the key are the remote host's, exactly as they are locally. Steps 1
and 2 above therefore have to have been done on that host — including the Node
version, which the same probe checks — and BitFun says so if they were not.

## Reopening a conversation

The bridge advertises ACP's `loadSession` capability, so closing a session and
clicking it again reopens the one that was there instead of quietly starting a
blank one. Without it a client has only `session/new` to fall back on, and the
reopened conversation loses its history, its context, and the mode it ran under
— it comes back under the roster default and switchable again.

`session/load` resumes the stored session out of the harness's own persistence
(`$DSH_HOME/acp-sessions/<project>/<session-id>/`), replays its events to the
client as `session/update` notifications, and answers with the session's mode
and model. Four consequences worth knowing:

- **The stored mode wins over the roster default.** Which preset a session ran
  under is read back from its own log, so a conversation started in `minimal`
  reopens in `minimal` however the default has moved since.
- **A conversation that has started comes back locked.** The mode picker shrinks
  to the one mode in force, because the composition is already baked into the
  transcript — the same rule a live session follows after its first turn.
- **The model comes back off the log too, and stays switchable.** The picker
  opens on the provider/model the session's own turns were logged under, not on
  whatever the dsh default has become. Unlike the mode it is never locked:
  swapping which model answers the next step leaves every logged turn valid.
- **A session belongs to the directory it was created in.** Loading it against
  another `cwd` is refused rather than answered with a session whose sandbox
  boundary points somewhere else.

`node scripts/smoke.mjs --load <session-id>` drives exactly this path against a
real installation; the id is a directory name under the path above, and `--cwd`
has to name the workspace the session was created in.

## Development

```sh
npm ci                               # the pinned harness toolchain
npm run build                        # tsc -> lib/
node scripts/build-profile.mjs       # lib/ + presets -> dist-profile/
node scripts/smoke.mjs               # drive the profile over real ACP
npm test                             # vitest
```

`pnpm run prepare:dsh-profile` from the repository root does the install and
both build steps. Official `desktop:build` ships `dist-profile/` as a Tauri
resource; `desktop:dev` and `cargo check` do not compile it. A failure during
packaging fails the desktop build: an app that silently ships no bridge is
indistinguishable from a working one until a user starts a DeepSeek session.
`BITFUN_SKIP_DSH_PROFILE=1` opts out on purpose.

HarmonyOS packaging runs `prepare:dsh-profile` through Tauri's
`beforeBuildCommand`. Build helpers that bypass that hook must run the same
script before staging the OHOS project, including when reusing frontend outputs.
The script stages the profile under
`src/apps/ohos/entry/src/main/resources/resfile/dsh-profile`, using
`bitfun-bridge.json` and `vendor-node-modules` as resource-safe aliases. Verify
that the final HAP contains the stamp, `lib/app.js`, `cordis.patch.yml`, and the
vendored dependencies under `resources/resfile/dsh-profile/`.

On HarmonyOS, the built-in `dsh` client first checks the launcher's
`--profile acp --dump-default-config` output for its native ACP transport. When
available, startup uses `--profile acp` so the transport matches the installed
runtime's APIs. Otherwise it keeps the bundled bridge path. This selection is
made at launch without rewriting persisted client configuration. A missing
bundled profile makes the legacy path unavailable even if the CLI is installed;
the probe reports the resource error. Custom client IDs continue to
launch their configured commands without BitFun materializing a profile.
To verify a packaged fix on HarmonyOS, add the built-in DeepSeek Harness preset,
create its session, send a prompt, and repeat after restarting BitFun. Use the
built-in client ID `dsh` for this check; a successful custom client does not test
the built-in provisioning and launch path. Model replies require a DeepSeek
API key configured in dsh; installing the CLI does not configure credentials.

Every `@deepseek-ai/*` dependency is pinned to the **`0.1.0-rc.6`** train — the
set npm's `next` dist-tag points at. Half of these packages still carry a
`latest` of `0.0.1-rc.1`, so an unpinned install mixes two trains and disagrees
with itself; that is worth knowing before loosening a range. They are
`devDependencies` because they are compile-time only: at runtime the profile
resolves them from the user's own dsh.

This package is **not** a pnpm workspace member and carries its own
`package-lock.json`, so installing the harness is the desktop bundle build's
cost rather than every contributor's `pnpm install`.

To work against a local [deepseek-harness](https://github.com/deepseek-ai)
checkout instead of the pinned versions, run `node scripts/link-local-dsh.mjs`
— it symlinks the checkout into `node_modules`, and the build then leaves that
tree alone.

## Layout

| Path | What it is |
| --- | --- |
| `src/app.ts` | the cordis plugin: config schema and ACP stdio transport |
| `src/bridge.ts` | session lifecycle, prompts, tool calls, permissions |
| `src/codec.ts` | harness events ⇄ ACP notifications |
| `src/tool-view.ts` | how a tool call is titled and rendered |
| `cordis.yml` | the composition; the profile patch is generated from it |
| `presets/` | the modes a session can switch between |
