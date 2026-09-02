#!/bin/bash
# download-template.sh — 下载鸿蒙工程模板归档 templates-0625.zip
#
# 适用场景：无 Qt 源码树时（仅预编译 SDK、鸿蒙 PC 编译构建），
# 从 GitCode releases 页面单独下载模板归档。
#
# 下载地址: https://gitcode.com/ohos-qt/qt-harmonyos-src/releases
# 归档名称: templates-0625.zip
#
# 用法:
#   bash download-template.sh [--dest=<目录>] [--url=<自定义下载URL>]
# 默认安装到 BitFun 用户级 Qt 迁移资源目录，--dest 仅用于兼容手动指定位置。
#
# 退出码: 0=成功, 1=参数错误, 2=下载失败

set -uo pipefail

# GitCode 要求浏览器 User-Agent，否则返回 401
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

DEST=""
CUSTOM_URL=""

for arg in "$@"; do
  case "$arg" in
    --dest=*) DEST="${arg#*=}" ;;
    --url=*)  CUSTOM_URL="${arg#*=}" ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

if [ -z "$DEST" ]; then
  if [ -n "${BITFUN_QT_MIGRATION_ROOT:-}" ]; then
    RESOURCE_ROOT="$BITFUN_QT_MIGRATION_ROOT"
  elif [ "$(uname -s)" = "Darwin" ]; then
    CONFIG_ROOT="${BITFUN_USER_ROOT:-${HOME}/Library/Application Support/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  elif [ "${OSTYPE:-}" = "msys" ] || [ "${OSTYPE:-}" = "cygwin" ] || [ "${OS:-}" = "Windows_NT" ]; then
    CONFIG_ROOT="${BITFUN_USER_ROOT:-${APPDATA:-${HOME:-}/AppData/Roaming}/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  elif [ -f "/etc/ohos-release" ] || [ -f "/etc/openharmony-release" ]; then
    RESOURCE_ROOT="${BITFUN_USER_ROOT:-/data/storage/el2/base/files/bitfun}/data/qt-migration"
  else
    DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}"
    CONFIG_ROOT="${BITFUN_USER_ROOT:-$DATA_ROOT/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  fi
  DEST="$RESOURCE_ROOT/templates/qt5.12.12/templates-0625"
fi

RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"
ARCHIVE_NAME="templates-0625.zip"

echo "--- 鸿蒙工程模板下载 ---"
echo "  目标: $DEST"
echo "  归档: $ARCHIVE_NAME"
echo ""

if [ -d "$DEST/qEmbeddedUiExtensionHost" ] \
  && [ -f "$DEST/entry/src/main/ets/common/QtAppConstants.ets" ] \
  && [ -f "$DEST/entry/src/main/ets/qability/QAbility.ets" ] \
  && [ -f "$DEST/entry/src/main/qt/libqohos.d.ts" ]; then
  echo "STATUS=already-exists"
  echo "模板目录已存在: $DEST"
  echo "OHOS_TEMPLATE_SRC=$DEST"
  exit 0
fi

mkdir -p "$DEST"

DOWNLOAD_URL=""
if [ -n "$CUSTOM_URL" ]; then
  DOWNLOAD_URL="$CUSTOM_URL"
else
  # 已验证的直接下载 URL
  DIRECT_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/templates-0625.zip"

  echo "尝试直接下载: $DIRECT_URL"
  DOWNLOAD_URL="$DIRECT_URL"
fi

echo "下载中: $DOWNLOAD_URL"
if [ -n "${BITFUN_QT_MIGRATION_DOWNLOADS:-}" ]; then
  DOWNLOAD_ROOT="$BITFUN_QT_MIGRATION_DOWNLOADS/templates"
else
  DOWNLOAD_ROOT="${TMPDIR:-/tmp}/bitfun-qt-migration-downloads/templates"
fi
mkdir -p "$DOWNLOAD_ROOT"
TMPFILE="$DOWNLOAD_ROOT/$ARCHIVE_NAME"
if curl -fSL -A "$UA" --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"; then
  echo "下载完成"
else
  echo "ERROR: 下载失败: $DOWNLOAD_URL"
  rm -f "$TMPFILE"
  echo ""
  echo "请手动下载："
  echo "  1. 访问 $RELEASES_URL"
  echo "  2. 下载 $ARCHIVE_NAME"
  echo "  3. 运行: bash download-template.sh --dest=$DEST --url=file:///path/to/$ARCHIVE_NAME"
  exit 2
fi

echo "解压中..."
case "$(basename "$DOWNLOAD_URL")" in
  *.zip)
    unzip -q -o "$TMPFILE" -d "$DEST" ;;
  *.tar.gz|*.tgz)
    tar xzf "$TMPFILE" -C "$DEST" ;;
  *)
    unzip -q -o "$TMPFILE" -d "$DEST" 2>/dev/null || tar xzf "$TMPFILE" -C "$DEST" ;;
esac
rm -f "$TMPFILE"

if [ -d "$DEST/qEmbeddedUiExtensionHost" ] \
  && [ -f "$DEST/entry/src/main/ets/common/QtAppConstants.ets" ] \
  && [ -f "$DEST/entry/src/main/ets/qability/QAbility.ets" ] \
  && [ -f "$DEST/entry/src/main/qt/libqohos.d.ts" ]; then
  echo "解压完成: $DEST"
  echo ""
  echo "STATUS=installed"
  echo "OHOS_TEMPLATE_SRC=$DEST"
  echo ""
  echo "模板目录结构："
  echo "  $DEST/"
  ls -1 "$DEST" | sed 's/^/  ├── /'
else
  NESTED=$(find "$DEST" -maxdepth 2 -name "build-profile.json5" -exec dirname {} \; | head -1)
  if [ -n "$NESTED" ] && [ "$NESTED" != "$DEST" ]; then
    echo "模板在子目录中，移动..."
    mv "$NESTED"/* "$DEST"/ 2>/dev/null
    mv "$NESTED"/.* "$DEST"/ 2>/dev/null
    rmdir "$NESTED" 2>/dev/null
    echo "STATUS=installed"
    echo "OHOS_TEMPLATE_SRC=$DEST"
  else
    echo "WARN: 解压完成但未检测到预期目录结构"
    echo "请检查: $DEST"
    echo "STATUS=extracted-unverified"
  fi
fi
