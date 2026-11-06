#!/bin/bash
# 用法:
#   ./package.sh                                  # 打包上游仓库 main 分支（HAP）
#   ./package.sh -b release/2.0.0                 # 指定分支（上游仓库）
#   ./package.sh -b release/2.0.0 -r https://gitcode.com/OpenBitFun/bitfun_ade.git   # 指定分支 + 指定仓库
#   ./package.sh -s -b release/2.0.0              # 只到 cargo tauri ohos build 编出 so（发布包在本地打 app 时用）
#   ./package.sh -a -b main                       # HAP 之后追加打 .app 包（cer.snippet 签 HAP，cer-app.snippet 签 .app）
#   ./package.sh --debug -s -b main               # cargo tauri ohos build 使用 debug profile（so 在 target/.../debug，签名不变）
# 参数: -b/--branch 分支（默认 main，支持 -b=x 写法）；-r/--repo 仓库（默认上游）；
#       -s/--so-only 只编 so；-a/--app 追加打 .app 包；-d/--debug debug profile 编译 so；-h/--help 帮助
set -e

BRANCH=main
REPO_URL=https://gitcode.com/OpenBitFun/bitfun_ade.git
SO_ONLY=0
WITH_APP=0
DEBUG_BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    -s|--so-only)
      SO_ONLY=1 ;;
    -a|--app)
      WITH_APP=1 ;;
    -a=*|--app=*)
      WITH_APP=1 ;;
    -d|--debug)
      DEBUG_BUILD=1 ;;
    -d=*|--debug=*)
      DEBUG_BUILD=1 ;;
    -b|--branch)
      [ $# -ge 2 ] || { echo "错误: $1 缺少分支参数"; exit 1; }
      BRANCH=$2; shift ;;
    -b=*|--branch=*)
      BRANCH=${1#*=} ;;
    -r|--repo)
      [ $# -ge 2 ] || { echo "错误: $1 缺少仓库参数"; exit 1; }
      REPO_URL=$2; shift ;;
    -r=*|--repo=*)
      REPO_URL=${1#*=} ;;
    -h|--help)
      sed -n '2,9p' "$0"; exit 0 ;;
    *)
      echo "未知参数: $1（-h 查看用法）"; exit 1 ;;
  esac
  shift
done

# 克隆目录名从仓库 URL 推导，仓库迁移/改名不影响后续路径
repo_dir="$(basename "$REPO_URL" .git)"

time=$(date +%Y-%m-%d-%H%M%S)
workpath=/root/workspace/$BRANCH/$time
mkdir -p "$workpath"
# 记录仓库绝对路径：收集步骤据此定位 dist/so 等，避免误认暂存目录
printf '%s\n' "$workpath/$repo_dir" > "$workpath/repo-path.txt"
cd "$workpath"

echo "==> 克隆 $REPO_URL (branch: $BRANCH)"
git clone -b "$BRANCH" --single-branch "$REPO_URL"
cd "$repo_dir"

# 记录实际打包的提交，供 Release tag 精确指向
git rev-parse HEAD > "$workpath/packaged-commit.txt"

cp -r /root/package-tools/hnp "$workpath/$repo_dir/src/apps/ohos/"
sed -i '/"type": "entry"/r /root/package-tools/hnpPackages.snippet' "$workpath/$repo_dir/src/apps/ohos/entry/src/main/module.json5"

# GitCode Release 需要 OHOS 工程整体源码（不含签名）：在 hnp 拷入与
# module.json5 注入之后、签名配置注入之前打包，包内 build-profile.json5
# 保持上游原样（signingConfigs 为空），也没有任何构建产物。zip 优先，
# 主机无 zip 时回退 tgz。
SOURCE_STAGING=$workpath/ohos-source-output
mkdir -p "$SOURCE_STAGING"
if command -v zip >/dev/null 2>&1; then
  (cd "$workpath/$repo_dir/src/apps" && zip -qr "$SOURCE_STAGING/ohos-source.zip" ohos)
else
  tar -czf "$SOURCE_STAGING/ohos-source.tgz" -C "$workpath/$repo_dir/src/apps" ohos
fi
echo "==> OHOS 工程源码包（不含签名）: $(ls "$SOURCE_STAGING")"

# HAP 使用 cer.snippet（name: default，与 product 的 signingConfig 对应）；
# .app 追加注入 cer-app.snippet（name: release），构建间切换签名
sed -i '/"signingConfigs": \[/r /root/package-tools/cer.snippet' "$workpath/$repo_dir/src/apps/ohos/build-profile.json5"
if [ "$WITH_APP" = "1" ]; then
  [ -f /root/package-tools/cer-app.snippet ] || { echo "错误: cer-app.snippet 不存在（-a 需要 .app 签名材料）"; exit 1; }
  sed -i '/"signingConfigs": \[/r /root/package-tools/cer-app.snippet' "$workpath/$repo_dir/src/apps/ohos/build-profile.json5"
fi

# 注入结果必须在昂贵构建前校验：signingConfigs 内名称必须唯一，default
# 恒需存在，-a 时 release 也必须存在。宿主 snippet 的 name 与约定不符时
# （例如 cer-app.snippet 也写成 default），hvigor 要到三十多分钟构建后才
# 报 Duplicated signingConfigs，这里在克隆后数秒内失败并打印签名区块。
OHOS_PROFILE="$workpath/$repo_dir/src/apps/ohos/build-profile.json5"
# 按括号深度计数提取 signingConfigs 区块：不依赖缩进宽度、也不依赖收尾
# 是否带逗号；区块未闭合（扫到文件尾深度未归零）或锚点缺失时 awk 以非零
# 退出，绝不用越界扫描到的 products/modules 名称做重名或缺失判断。
signing_block="$(awk '
  /"signingConfigs": \[/ { found = 1 }
  found {
    print
    depth += gsub(/\[/, "")
    depth -= gsub(/\]/, "")
    if (depth <= 0) exit
  }
  END { if (!found || depth > 0) exit 1 }
' "$OHOS_PROFILE")" || {
  echo "错误: 未能完整解析 signingConfigs 区块（$OHOS_PROFILE 的锚点缺失或区块未闭合）。" >&2
  exit 1
}
signing_names="$(printf '%s\n' "$signing_block" | grep -o '"name": "[^"]*"' || true)"
duplicate_names="$(printf '%s\n' "$signing_names" | sort | uniq -d | tr -d '"' | tr '\n' ' ' || true)"
if [ -n "$duplicate_names" ]; then
  echo "错误: build-profile.json5 的 signingConfigs 重名（$duplicate_names）。" >&2
  echo "请检查宿主 /root/package-tools/cer.snippet（应为 name: default）与 cer-app.snippet（应为 name: release）。" >&2
  printf '%s\n' "$signing_block" >&2
  exit 1
fi
printf '%s\n' "$signing_names" | grep -q '"name": "default"' || {
  echo "错误: signingConfigs 中缺少 name: default（cer.snippet 注入未生效？）" >&2
  exit 1
}
if [ "$WITH_APP" = "1" ]; then
  printf '%s\n' "$signing_names" | grep -q '"name": "release"' || {
    echo "错误: -a 模式下 signingConfigs 中缺少 name: release（cer-app.snippet 的 name 不是 release？）" >&2
    printf '%s\n' "$signing_block" >&2
    exit 1
  }
fi
pnpm install
# 前端构建按分支结构自适应：含 design-system 的分支（如 release/2.0.0）
# 需要先构建设计系统包、再准备插件宿主，最后单独构建 mobile-web
if [ -f design-system/package.json ]; then
  echo "==> 前端构建（design-system 分支链路）"
  pnpm --dir design-system run build:packages
  npm run build
  pnpm run plugin-host:prepare
  pnpm --dir src/mobile-web run build
else
  echo "==> 前端构建（默认链路）"
  npm run build
fi
cd "$workpath/$repo_dir/src/apps/desktop"
cargo tauri ohos init
# 编出so，后续的hvigorw打包不能用这一步的命令，所以在这之前环境变量中没有hvigorw最好，有也不影响
# 该命令内部打包阶段（hvigorw/java）固定失败属预期，只要求 so 产出；是否成功由下方 SO_FILE 校验兜底
TAURI_BUILD_ARGS=''
if [ "$DEBUG_BUILD" = "1" ]; then
  TAURI_BUILD_ARGS='--debug'
  echo "==> cargo tauri ohos build --debug（so 输出在 target/aarch64-unknown-linux-ohos/debug）"
fi
cargo tauri ohos build $TAURI_BUILD_ARGS || echo "==> cargo tauri ohos build 非零退出（打包阶段失败可忽略），继续执行"

# so 名按分支自动适配：main 分支与 2.0.0 分支均为 libbitfun_desktop_lib.so，这里用通配探测，无需写死；
# so 所在 profile 目录跟随 --debug：release 或 debug
if [ "$DEBUG_BUILD" = "1" ]; then
  SO_DIR=$workpath/$repo_dir/target/aarch64-unknown-linux-ohos/debug
else
  SO_DIR=$workpath/$repo_dir/target/aarch64-unknown-linux-ohos/release
fi
SO_FILE=$(ls "$SO_DIR"/lib*desktop_lib.so 2>/dev/null | head -n 1)
DIST_FILE_PATH=$workpath/$repo_dir/src/mobile-web/dist
[ -n "$SO_FILE" ] || { echo "desktop_lib.so 不存在（$SO_DIR 下未找到 lib*desktop_lib.so）"; exit 1; }
[ -d "$DIST_FILE_PATH" ] || { echo "src/mobile-web/dist不存在"; exit 1; }

# 暂存 so：收集步骤与 profile 目录解耦（release/debug 都从这里取）
SO_STAGING=$workpath/so-output
mkdir -p "$SO_STAGING"
cp "$SO_FILE" "$SO_STAGING/"

if [ "$SO_ONLY" = "1" ]; then
  echo "==> so-only 模式完成，跳过复制与打包。"
  echo "==> so:     $SO_FILE"
  echo "==> dist:   $DIST_FILE_PATH"
  echo "==> 本地打 app 时取以上两处产物即可。"
  exit 0
fi

SO_DEST_PATH=$workpath/$repo_dir/src/apps/ohos/entry/libs/arm64-v8a
[ -d "$SO_DEST_PATH" ] || { mkdir -p "$SO_DEST_PATH"; }
# mobile-web/dist 由新工程构建自动生成并注入 resfile，无需手动复制
echo "==> 复制 $(basename "$SO_FILE") 到 src/apps/ohos"
cp "$SO_FILE" "$SO_DEST_PATH"

cd "$workpath/$repo_dir/src/apps/ohos"
export PATH="/root/command-line-tools/bin:$PATH"
ohpm install --all
echo "==> assembleHap（签名: cer.snippet / default）"
hvigorw --mode module -p product=default -p module=entry@default assembleHap
HAP_OUT_DIR=$workpath/$repo_dir/src/apps/ohos/entry/build/default/outputs/default
echo "==> HAP 完成。产物: $HAP_OUT_DIR"

if [ "$WITH_APP" = "1" ]; then
  # assembleApp 会以 release 签名重建 HAP 并覆盖 outputs 目录，
  # 先把 default 签名的 HAP 复制到独立暂存目录保住产物
  HAP_STAGING=$workpath/hap-output
  mkdir -p "$HAP_STAGING"
  cp "$HAP_OUT_DIR/entry-default-signed.hap" "$HAP_STAGING/" || { echo "未找到可暂存的 HAP 产物"; exit 1; }
  # 切换 product 签名到 release（cer-app.snippet），增量出 .app
  sed -i 's/"signingConfig": "default"/"signingConfig": "release"/' "$workpath/$repo_dir/src/apps/ohos/build-profile.json5"
  echo "==> assembleApp（签名: cer-app.snippet / release）"
  hvigorw --mode project -p product=default assembleApp
  APP_FILE=$workpath/$repo_dir/src/apps/ohos/build/outputs/default/ohos-default-signed.app
  [ -f "$APP_FILE" ] || { echo "未找到 .app 产物: $APP_FILE"; exit 1; }
  APP_STAGING=$workpath/app-output
  mkdir -p "$APP_STAGING"
  cp "$APP_FILE" "$APP_STAGING/"
  echo "==> APP 完成。产物: $APP_STAGING/$(basename "$APP_FILE")"
fi
