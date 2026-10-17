# BitFun ADE GitCode 流水线

本目录是 GitCode（AtomGit Action）流水线配置。当前包含 OHOS 流水线和
Windows / macOS 交叉编译检查；桌面打包 / 全量 CI 仍保留在 GitHub Actions
（`.github/workflows/`）。
语法参考 `bitfun_agent_kernel/.gitcode`。

## Workflow

- `workflows/bitfun_ade_ohos_ci.yml`：PR（open/update/reopen，面向 main /
  release/2.0.0）触发，另保留 `workflow_dispatch` 手动触发；不设 push 触发器
  （2026-10 曾临时启用 push 验证 runner，验证完成后移除）。
- `workflows/bitfun_ade_ohos_package.yml`：`workflow_dispatch` 手动触发的一键
  签名打包。流水线 checkout 本仓库后直接执行仓库内脚本
  `.gitcode/package.sh`，无需主机侧脚本副本。支持 `branch` / `repo` /
  `so_only` / `build_app` 输入：`build_app` 走 `assembleApp` 出 `.app` 包并使用
  主机 `/root/package-tools/cer-app.snippet`（release 签名材料）；产物收集后经
  `upload-artifact` 上传。勾选 `upload_to_release` 并填 `release_tag` 时，另通过
  `scripts/ci/publish-gitcode-release.mjs` 把 HAP/.app 挂到 GitCode Release
  （幂等：release 已存在则复用，同名 asset 跳过；so 与 mobile-web dist
  压缩档仅进本地输出目录与 artifact，不上传 Release）。产物包名与
  Release 元信息独立设置：`package_name` 只改 HAP/.app 文件名主干
  （不填回退 `release_tag`），`release_title` 只改 Release 标题（不填
  默认为 tag，重跑不填保留原标题）。
  **前置**：仓库需配置 Secret `GIT_TOKEN`（GitCode 个人访问令牌，
  `atomgit.repository` 指向的仓库）。
- `workflows/bitfun_ade_windows_macos_ci.yml`：PR（open/update/reopen，面向
  main / release/2.0.0）触发的桌面应用交叉编译检查，结构与 OHOS CI 一致
  （classify 门禁 → 磁盘清理 → 容器 → 检查 → 清理），两个 job 无 `needs`
  依赖、独立调度：
  - Windows：镜像 `rust-ci-windows:20260813`，`cargo xwin check --locked
    --release --target x86_64-pc-windows-msvc`；
  - macOS：镜像 `rust-ci-macos:20260813`，`cargo check --locked --release
    --target aarch64-apple-darwin`，C/C++ 走 `cargo-zigbuild zig cc` 包装
    （`SDKROOT=/opt/MacOSX.sdk`）。
  检查命令均指向 `src/apps/desktop/Cargo.toml`（与 OHOS job 相同的桌面
  crate），并按 GitHub CI（`ci.yml`）的占位约定预创建 tauri build script
  读取的 `dist/`、`src/mobile-web/dist/`、
  `src/apps/extension-host/dist/extension-host.js` 占位路径（真实产物仅在
  打包时需要）。target 缓存分别为
  `/opt/.gitcode-cache/target/ade-windows`、`/opt/.gitcode-cache/target/ade-macos`，
  Cargo registry/git 缓存与其他流水线共享（首次运行前需用 OHOS 镜像的
  git db 播种，避免在线克隆 GitHub fork 依赖）。

### sherpa-onnx 预编译库种子缓存

桌面 crate 默认启用 `local-speech`，`sherpa-onnx-sys` 的 build script 会在
构建时从 GitHub 下载预编译库；Runner 上该下载不稳定（响应中断导致
`response body closed before all bytes were read` panic）。Windows / macOS
job 复用 `/opt/.gitcode-cache` 宿主机持久缓存模式：把
`/opt/.gitcode-cache/sherpa-onnx` 以只读语义挂载进容器
（`/opt/sherpa-onnx-cache`），并通过
`SHERPA_ONNX_ARCHIVE_DIR=/opt/sherpa-onnx-cache` 交给 build script——它从
该目录取归档复制进 `target/sherpa-onnx-prebuilt/` 并解压，之后 target 缓存
持久命中，不再触碰网络。

Runner 主机需一次性播种预下载的发布归档（本机 `target/sherpa-onnx-prebuilt/`
下的同名文件可直接复用）：

| Job | 归档文件 |
| --- | --- |
| Windows | `sherpa-onnx-v1.13.4-win-x64-static-MT-Release-lib.tar.bz2` |
| macOS | `sherpa-onnx-v1.13.4-osx-arm64-static-lib.tar.bz2` |

两个 job 各有一个 `Verify sherpa-onnx seed archive` 步骤在构建前校验归档
存在，缺失时立即报错并提示播种路径（避免进入深层 build.rs panic）。

### Job 说明

单 job 结构（GitCode 对表达式上下文有限制，门控以内嵌 step 实现）：

| Step | 触发条件 | 内容 |
| --- | --- | --- |
| Checkout / Classify | 总是 | 用 `scripts/ci/classify-rust-impact.mjs` 按改动分类，产出 `run` 门控输出 |
| 磁盘清理 | `run == 'true'` | `/opt` 剩余空间低于 10G 时清理 target 缓存 |
| 容器构建检查 | `run == 'true'` | `pnpm install` → `npm run build` → `pnpm --filter bitfun-mobile-web build` → `cargo check --target aarch64-unknown-linux-ohos --release` |
| 容器清理 | 总是（`always()`） | `docker rm -f` 清理容器 |

前端（`src/web-ui/**`）、纯文档（`.md`、`png/**`）改动会跳过整个容器检查；
其余改动都会运行。

### 执行模型

- 自托管 Linux Runner 上通过 Docker 运行自包含镜像
  `swr.cn-north-4.myhuaweicloud.com/bitfun/bitfun-ade-ohos-ci:20260818`，
  与 `bitfun_agent_kernel` 的 CI 模式一致。
- 镜像在构建时内置全部环境：node + pnpm、Rust 工具链（含
  `aarch64-unknown-linux-ohos` target）、OHOS NDK 及全部所需环境变量
  （`OHOS_NDK_HOME` 等）。容器启动时不挂载主机工具链，运行时也不导出
  任何环境变量；换镜像版本只需修改 job env 中的 `IMAGE`。
- 容器挂载：工作区（`$PWD:/workspace`）、
  `/opt/.gitcode-cache/target/ade-ohos` 编译缓存（跨运行持久化，增量编译
  显著加速），以及与其他流水线同模式的
  `/opt/.gitcode-cache/cargo/registry`、`/opt/.gitcode-cache/cargo/git`
  Cargo 缓存（宿主机 `CARGO_HOME` 下对应目录）。镜像内置 git db 里可能
  缺少 Cargo.lock 新 pin 的 rev（如 `openharmony-ability`），导致每次构建
  都要在线 fetch GitHub 并间歇性失败；git db 持久化后首次成功 fetch 的
  rev 即永久命中。宿主机 git 缓存为空时会自动用镜像内置 db 播种。
- 容器启动后有 `Warm cargo caches (retried)` 步骤：在构建前端之前
  `cargo fetch --locked` 重试至多 5 次（间隔 20s），把 GitHub git 依赖的
  瞬时网络抖动挡在正式构建之前；失败 5 次才报错。
- checkout 统一取 `atomgit.event.pull_request.head.sha`，因为 GitCode 不保证
  提供合成 merge ref（`atomgit.sha` 仅作为非 PR 事件的兜底）。

## 自托管 Runner 要求

OHOS CI 的 job 使用 `[self-hosted, os=ubuntu, target=ohos]`，标签必须与 Runner
注册时的标签集合一致（当前 Runner `bitfun-ade-ohos` 注册为 `self-hosted` +
`os=ubuntu` + `target=ohos`）；若注册标签变化，请同步修改所有 job 的 `runs-on`。

打包流水线（`bitfun_ade_ohos_package.yml`）使用独立标签
`[self-hosted, os=ubuntu, target=ohos_package]`，与 OHOS CI 的 runner 池
不共用：打包主机承载签名材料与主机侧打包工具，CI 的长前端构建不应
挤占签名打包。需要注册一台带 `target=ohos_package` 标签的专用 runner。

Windows / macOS job 额外要求 `target=windows` / `target=macos` 标签
（与 `bitfun_agent_kernel` 的 runner 池一致）；若暂时没有带这些标签的
runner，可把对应 job 的 `runs-on` 放宽为 `[self-hosted, os=ubuntu]`，
交叉编译镜像本身是自包含的，任何可跑 Docker 的 Linux runner 都能执行。

Runner 主机需要：

- Docker 可用（拉取 SWR 镜像、启动/清理容器）；
- git、Node.js >= 22（Classify 分类脚本在主机上运行）；
- 仓库设置中已启用 Actions / 流水线；
- `/opt` 可写且有足够磁盘（target 缓存，建议预留 30G 以上）。
