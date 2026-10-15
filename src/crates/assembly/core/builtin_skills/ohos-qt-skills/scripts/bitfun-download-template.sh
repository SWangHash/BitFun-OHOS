#!/bin/bash
# download-template.sh (BitFun) — acquire the Qt-for-HarmonyOS template tree
# `templates-0625.zip` and install it into the root BitFun scans.
#
# Why this script exists instead of calling the vendored upstream
# `upstream-kb/knowledge/skills/kb-init/scripts/download-template.sh`:
#
#   * the install root is BitFun's, not the caller's working directory: the
#     migration intake scan reads `<qt_migration_root>/templates/**` and derives
#     `managed_template_available` from it, so a template extracted anywhere else
#     is invisible to the card and to the next migration;
#   * the upstream copy requires an explicit `--dest` and documents the knowledge
#     base's own `workspace/templates`, which the scan never looks at;
#   * the ready-check below is the scan's own template predicate
#     (`entry/src/main/ets/common/QtAppConstants.ets`,
#     `entry/src/main/ets/qability/QAbility.ets`, `entry/src/main/qt/libqohos.d.ts`),
#     not a weaker `entry/ + build-profile.json5` probe, so "installed" means
#     "detected by the intake".
#
# 用法:
#   bash <skill>/scripts/bitfun-download-template.sh \
#     [--platform=<macos|windows|linux|harmonyos>] [--dest=<目录>] [--url=<下载URL|file://路径>]
#
# 默认安装到 <qt_migration_root>/templates/qt5.12.12/templates-0625。
# 资源根判定: BITFUN_QT_MIGRATION_ROOT > --platform > 自动探测。
# --dest 仅用于用户明确要求换位置；迁移流程必须使用脚本输出的 OHOS_TEMPLATE_SRC。
#
# 输出: STATUS=already-exists|installed, OHOS_TEMPLATE_SRC=<模板根目录>
# 退出码: 0=成功, 1=参数错误, 2=下载失败, 3=结构校验失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bitfun-resource-root.sh
. "$SCRIPT_DIR/bitfun-resource-root.sh"

ARCHIVE_NAME="templates-0625.zip"
DIRECT_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/$ARCHIVE_NAME"
RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"

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

if [ -z "$DEST" ]; then
  DEST="$(bitfun_qt_resource_root "$PLATFORM")/templates/qt5.12.12/templates-0625"
fi

# Template predicate of the migration scan (`is_qt_harmonyos_template`), so the
# script cannot report success for a tree the intake would not offer.
template_ready() {
  [ -f "$1/entry/src/main/ets/common/QtAppConstants.ets" ] \
    && [ -f "$1/entry/src/main/ets/qability/QAbility.ets" ] \
    && [ -f "$1/entry/src/main/qt/libqohos.d.ts" ]
}

echo "--- 鸿蒙工程模板下载 ---"
echo "  平台: ${PLATFORM:-<auto>}"
echo "  目标: $DEST"
echo "  归档: $ARCHIVE_NAME"
echo ""

if template_ready "$DEST"; then
  echo "STATUS=already-exists"
  echo "模板目录已存在: $DEST"
  echo "OHOS_TEMPLATE_SRC=$DEST"
  exit 0
fi

mkdir -p "$DEST"

DOWNLOAD_URL="${CUSTOM_URL:-$DIRECT_URL}"
DOWNLOAD_ROOT="$(bitfun_qt_download_dir templates)"
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
  echo "  3. 运行: bash $0 --dest=$DEST --url=file:///path/to/$ARCHIVE_NAME"
  exit 2
fi

echo "解压中..."
case "$(basename "${DOWNLOAD_URL%%\?*}")" in
  *.zip)
    unzip -q -o "$TMPFILE" -d "$DEST" ;;
  *.tar.gz|*.tgz)
    tar xzf "$TMPFILE" -C "$DEST" ;;
  *)
    unzip -q -o "$TMPFILE" -d "$DEST" 2>/dev/null || tar xzf "$TMPFILE" -C "$DEST" ;;
esac
rm -f "$TMPFILE"

# The archive may carry one extra top-level directory; move its contents up so
# the template root is exactly `$DEST`.
if ! template_ready "$DEST"; then
  NESTED=$(find "$DEST" -maxdepth 2 -name "build-profile.json5" -exec dirname {} \; 2>/dev/null | head -1)
  if [ -n "$NESTED" ] && [ "$NESTED" != "$DEST" ]; then
    echo "模板在子目录中，上移: $NESTED"
    mv "$NESTED"/* "$DEST"/ 2>/dev/null
    mv "$NESTED"/.[!.]* "$DEST"/ 2>/dev/null
    rmdir "$NESTED" 2>/dev/null
  fi
fi

if ! template_ready "$DEST"; then
  echo "ERROR: 解压后未通过迁移扫描的模板结构校验: $DEST"
  echo "  需要 entry/src/main/ets/common/QtAppConstants.ets、entry/src/main/ets/qability/QAbility.ets、entry/src/main/qt/libqohos.d.ts"
  echo "STATUS=invalid-template"
  exit 3
fi

echo "解压完成: $DEST"
echo ""
echo "STATUS=installed"
echo "OHOS_TEMPLATE_SRC=$DEST"
echo ""
if [ ! -d "$DEST/qEmbeddedUiExtensionHost" ]; then
  echo "注: 未包含 qEmbeddedUiExtensionHost 目录；迁移扫描不要求该 Qt5 标记目录。"
fi
echo "模板目录结构："
echo "  $DEST/"
ls -1 "$DEST" | sed 's/^/  ├── /'
