#!/bin/bash
# download-qt-sdk.sh (BitFun) — backstop acquisition of the Qt 5.12.12
# Qt-for-HarmonyOS SDK (arm64-v8a, GLES), installed under the managed root.
#
# The runtime provisioner owns the normal install: it is what answers an
# `__official__` **toolchain** binding, it verifies the kit before publishing it,
# and it writes the installed kit root back into the binding. This script only
# runs as the documented backstop when that provisioning failed, and it exists so
# the fallback still lands where BitFun looks:
#
#   * install root = `<qt_migration_root>/toolchains` (the scan's managed tier and
#     the root the runtime provisioner publishes into), never the working
#     directory and never the vendored upstream script's required `--dest`;
#   * the ready-check is the scan's own toolchain predicate (`bin/qmake` or
#     `bin/qmake.exe`), so the printed kit root is one the intake candidate scan
#     actually offers;
#   * the archive is transferred through the BitFun download cache and removed
#     afterwards, leaving only reusable resources under the install root.
#
# The vendored copy at
# `upstream-kb/knowledge/skills/kb-init/scripts/download-qt-sdk.sh` requires both
# `--platform` and `--dest`, resolves no BitFun root, and leaves the archive
# inside the install directory; it is a knowledge-base reference, not this flow.
#
# 用法:
#   bash <skill>/scripts/bitfun-download-qt-sdk.sh --platform=<macos|windows|linux|harmonyos> \
#     [--dest=<目录>] [--url=<下载URL|file://路径>]
#
# 默认安装到 <qt_migration_root>/toolchains/qt5.12.12/<platform>-arm64-gles。
# 资源根判定: BITFUN_QT_MIGRATION_ROOT > --platform > 自动探测。
# --dest 仅用于用户明确要求换位置；迁移流程必须使用脚本输出的 QT5_12_OHOS_SDK。
#
# 输出: STATUS=already-exists|installed, QT5_12_OHOS_SDK=<kit root>
# 退出码: 0=成功, 1=参数错误或不支持的平台, 2=下载失败, 3=结构校验失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bitfun-resource-root.sh
. "$SCRIPT_DIR/bitfun-resource-root.sh"

RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"
RELEASE_TAG="v5.12.12"

PLATFORM=""
DEST=""
CUSTOM_URL=""

for arg in "$@"; do
  case "$arg" in
    --platform=*) PLATFORM="${arg#*=}" ;;
    --dest=*)     DEST="${arg#*=}" ;;
    --url=*)      CUSTOM_URL="${arg#*=}" ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

if [ -z "$PLATFORM" ]; then
  echo "ERROR: 必须指定 --platform=<macos|windows|linux|harmonyos>"
  echo "用法: bash bitfun-download-qt-sdk.sh --platform=<macos|windows|linux|harmonyos> [--dest=<目录>] [--url=<下载URL>]"
  exit 1
fi

# Asset per layout platform token. `linux` runs the Git Bash workflow and takes
# the Windows kit, exactly as the layout token documented before; upstream
# publishes no Linux kit.
case "$PLATFORM" in
  macos)     ASSET_PLATFORM="macos" ;;
  windows)   ASSET_PLATFORM="windows" ;;
  linux)     ASSET_PLATFORM="windows" ;;
  harmonyos) ASSET_PLATFORM="harmonyos" ;;
  *)
    echo "ERROR: 不支持的平台: $PLATFORM"
    exit 1
    ;;
esac

ARCHIVE_NAME="Qt-5.12.12-arm64-v8a-$ASSET_PLATFORM-gles.zip"
DIRECT_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/$RELEASE_TAG/$ARCHIVE_NAME"

if [ -z "$DEST" ]; then
  DEST="$(bitfun_qt_resource_root "$PLATFORM")/toolchains/qt5.12.12/$PLATFORM-arm64-gles"
fi

# Toolchain predicate of the migration scan (`QMAKE_EXECUTABLES`).
kit_ready() {
  [ -f "$1/bin/qmake" ] || [ -f "$1/bin/qmake.exe" ]
}

echo "--- Qt OHOS SDK 下载（回退路径）---"
echo "  平台: $PLATFORM (asset: $ASSET_PLATFORM)"
echo "  目标: $DEST"
echo ""

find_kit_root() {
  local dir
  # The archive's own top-level directory first, then any direct child that
  # carries qmake (an older or renamed kit layout).
  for dir in "$1"/Qt5.12* "$1"/qt5.12* "$1"/Qt5.15* "$1"/qt5.15*; do
    if [ -d "$dir" ] && kit_ready "$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  for dir in "$1"/*/; do
    dir="${dir%/}"
    if [ -d "$dir" ] && kit_ready "$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

if KIT_ROOT=$(find_kit_root "$DEST"); then
  echo "STATUS=already-exists"
  echo "SDK 目录已存在: $KIT_ROOT"
  echo "QT5_12_OHOS_SDK=$KIT_ROOT"
  exit 0
fi

mkdir -p "$DEST"

DOWNLOAD_URL="${CUSTOM_URL:-$DIRECT_URL}"
DOWNLOAD_ROOT="$(bitfun_qt_download_dir toolchains)"
mkdir -p "$DOWNLOAD_ROOT"
TMPFILE="$DOWNLOAD_ROOT/$ARCHIVE_NAME"

echo "下载中: $DOWNLOAD_URL"
if curl -fSL -A "$BITFUN_QT_CURL_UA" --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"; then
  echo "下载完成"
else
  rm -f "$TMPFILE"
  echo "ERROR: 下载失败: $DOWNLOAD_URL"
  echo ""
  echo "请手动下载："
  echo "  1. 访问 $RELEASES_URL"
  echo "  2. 下载 $ARCHIVE_NAME"
  echo "  3. 运行: bash $0 --platform=$PLATFORM --dest=$DEST --url=file:///path/to/$ARCHIVE_NAME"
  exit 2
fi

echo "解压中..."
case "$ARCHIVE_NAME" in
  *.zip)
    unzip -q -o "$TMPFILE" -d "$DEST" ;;
  *.tar.gz|*.tgz)
    tar xzf "$TMPFILE" -C "$DEST" ;;
  *.tar.xz)
    tar xJf "$TMPFILE" -C "$DEST" ;;
  *)
    echo "ERROR: 未知的压缩格式: $ARCHIVE_NAME"
    echo "请手动解压到: $DEST"
    rm -f "$TMPFILE"
    exit 2
    ;;
esac
rm -f "$TMPFILE"

if ! KIT_ROOT=$(find_kit_root "$DEST"); then
  echo "ERROR: 解压后未通过迁移扫描的工具链结构校验（缺 bin/qmake）: $DEST"
  echo "STATUS=invalid-kit"
  exit 3
fi

echo "解压完成: $KIT_ROOT"
echo ""
echo "STATUS=installed"
echo "QT5_12_OHOS_SDK=$KIT_ROOT"
