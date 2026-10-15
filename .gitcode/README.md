# BitFun ADE GitCode 流水线

本目录是 GitCode（AtomGit Action）流水线配置。当前仅包含 OHOS 流水线；
Windows / macOS / 桌面打包 / 全量 CI 仍保留在 GitHub Actions（`.github/workflows/`）。
语法参考 `bitfun_agent_kernel/.gitcode`。

## Workflow

- `workflows/bitfun_ade_ohos_ci.yml`：PR（open/update/reopen，面向 main）触发。
  验证阶段临时启用了 `push: branches: [main]` 触发器，稳定后移除。
- `workflows/bitfun_ade_ohos_package.yml`：`workflow_dispatch` 手动触发的一键
  签名打包。流水线 checkout 本仓库后直接执行仓库内脚本
  `.gitcode/package.sh`，无需主机侧脚本副本。支持 `branch` / `repo` /
  `so_only` / `build_app` 输入：`build_app` 走 `assembleApp` 出 `.app` 包并使用
  主机 `/root/package-tools/cer-app.snippet`（release 签名材料）；产物收集后经
  `upload-artifact` 上传。勾选 `upload_to_release` 并填 `release_tag` 时，另通过
  `scripts/ci/publish-gitcode-release.mjs` 把 HAP/app/so 挂到 GitCode Release
  （幂等：release 已存在则复用，同名 asset 跳过）。
  **前置**：仓库需配置 Secret `GIT_TOKEN`（GitCode 个人访问令牌，
  `atomgit.repository` 指向的仓库）。

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
- 容器仅挂载两个目录：工作区（`$PWD:/workspace`）与
  `/opt/.gitcode-cache/target/ade-ohos` 编译缓存；后者跨运行持久化，
  增量编译显著加速。
- checkout 统一取 `atomgit.event.pull_request.head.sha`，因为 GitCode 不保证
  提供合成 merge ref（`atomgit.sha` 仅作为非 PR 事件的兜底）。

## 自托管 Runner 要求

`runs-on: [self-hosted, os=ubuntu]`，标签必须与 Runner 注册时的标签集合一致
（当前 Runner `bitfun-ade-ohos` 注册为 `self-hosted` + `os=ubuntu`）；
若注册标签变化，请同步修改所有 job 的 `runs-on`。

Runner 主机需要：

- Docker 可用（拉取 SWR 镜像、启动/清理容器）；
- git、Node.js >= 22（Classify 分类脚本在主机上运行）；
- 仓库设置中已启用 Actions / 流水线；
- `/opt` 可写且有足够磁盘（target 缓存，建议预留 30G 以上）。
