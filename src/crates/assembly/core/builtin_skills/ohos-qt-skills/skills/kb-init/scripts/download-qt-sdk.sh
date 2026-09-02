#!/bin/bash
# download-qt-sdk.sh — 下载 Qt OHOS 预编译 SDK
#
# 用法: bash skills/kb-init/scripts/download-qt-sdk.sh --platform=<macos|windows|linux|harmonyos> [--dest=<目录>]
# 默认安装到 BitFun 用户级 Qt 迁移资源目录，--dest 仅用于兼容手动指定位置。
# 退出码: 0=成功, 1=失败

set -uo pipefail

# GitCode 要求浏览器 User-Agent，否则返回 401
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

PLATFORM=""
DEST=""

for arg in "$@"; do
  case "$arg" in
    --platform=*) PLATFORM="${arg#*=}";;
    --dest=*) DEST="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

if [ -z "$PLATFORM" ]; then
  echo "用法: bash download-qt-sdk.sh --platform=<macos|windows|linux|harmonyos> [--dest=<目录>]"
  exit 2
fi

if [ -z "$DEST" ]; then
  if [ -n "${BITFUN_QT_MIGRATION_ROOT:-}" ]; then
    RESOURCE_ROOT="$BITFUN_QT_MIGRATION_ROOT"
  elif [ "$PLATFORM" = "windows" ]; then
    CONFIG_ROOT="${BITFUN_USER_ROOT:-${APPDATA:-${HOME:-}/AppData/Roaming}/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  elif [ "$PLATFORM" = "macos" ]; then
    CONFIG_ROOT="${BITFUN_USER_ROOT:-${HOME}/Library/Application Support/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  elif [ "$PLATFORM" = "harmonyos" ]; then
    RESOURCE_ROOT="${BITFUN_USER_ROOT:-/data/storage/el2/base/files/bitfun}/data/qt-migration"
  else
    DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}"
    CONFIG_ROOT="${BITFUN_USER_ROOT:-$DATA_ROOT/BitFun}"
    RESOURCE_ROOT="$CONFIG_ROOT/data/qt-migration"
  fi
  DEST="$RESOURCE_ROOT/toolchains/qt5.12.12/$PLATFORM-arm64-gles"
fi

RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"

echo "--- Qt OHOS SDK 下载 ---"
echo "  平台: $PLATFORM"
echo "  目标: $DEST"
echo ""

# 创建目标目录
mkdir -p "$DEST"

# 已验证的直接下载 URL（Qt 5.12.12, GLES, arm64-v8a）
DIRECT_URLS_WINDOWS="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip"
DIRECT_URLS_MACOS="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-macos-gles.zip"
DIRECT_URLS_HARMONYOS="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-harmonyos-gles.zip"

# 根据平台选择直接下载 URL
case "$PLATFORM" in
  macos)     DIRECT_URL="$DIRECT_URLS_MACOS";;
  windows)   DIRECT_URL="$DIRECT_URLS_WINDOWS";;
  linux)     DIRECT_URL="$DIRECT_URLS_WINDOWS";;  # Linux 使用 Windows 版（在 Git Bash 中运行）
  harmonyos) DIRECT_URL="$DIRECT_URLS_HARMONYOS";;
  *) echo "不支持的平台: $PLATFORM"; exit 1;;
esac

MATCHED_NAME=$(basename "$DIRECT_URL")
MATCHED_URL="$DIRECT_URL"

echo "将下载: $MATCHED_NAME"
echo "下载地址: $MATCHED_URL"
echo ""

# 下载到 BitFun 缓存目录，安装目录只保留解压后的可复用资源。
if [ -n "${BITFUN_QT_MIGRATION_DOWNLOADS:-}" ]; then
  DOWNLOAD_ROOT="$BITFUN_QT_MIGRATION_DOWNLOADS/toolchains"
else
  DOWNLOAD_ROOT="${TMPDIR:-/tmp}/bitfun-qt-migration-downloads/toolchains"
fi
mkdir -p "$DOWNLOAD_ROOT"
DOWNLOAD_FILE="$DOWNLOAD_ROOT/$MATCHED_NAME"
echo "正在下载..."
if command -v curl &>/dev/null; then
  curl -L -A "$UA" -o "$DOWNLOAD_FILE" "$MATCHED_URL"
elif command -v wget &>/dev/null; then
  wget -U "$UA" -O "$DOWNLOAD_FILE" "$MATCHED_URL"
fi

if [ ! -f "$DOWNLOAD_FILE" ]; then
  echo "下载失败。请手动下载: $MATCHED_URL"
  rm -f "$DOWNLOAD_FILE"
  exit 1
fi

echo "下载完成: $DOWNLOAD_FILE"
echo ""

# 解压
echo "正在解压..."
case "$MATCHED_NAME" in
  *.zip)
    unzip -q -o "$DOWNLOAD_FILE" -d "$DEST"
    ;;
  *.tar.gz|*.tgz)
    tar xzf "$DOWNLOAD_FILE" -C "$DEST"
    ;;
  *.tar.xz)
    tar xJf "$DOWNLOAD_FILE" -C "$DEST"
    ;;
  *.7z)
    if command -v 7z &>/dev/null; then
      7z x "$DOWNLOAD_FILE" -o"$DEST" -y >/dev/null
    else
      echo "需要 7z 来解压 .7z 文件。请安装 p7zip 或手动解压。"
      exit 1
    fi
    ;;
  *)
    echo "未知的压缩格式: $MATCHED_NAME"
    echo "请手动解压到: $DEST"
    exit 1
    ;;
esac
rm -f "$DOWNLOAD_FILE"

echo "解压完成。"
echo ""

# 查找解压后的 SDK 目录
SDK_PATH=""
for d in "$DEST"/Qt5.12* "$DEST"/qt5.12* "$DEST"/Qt5.15* "$DEST"/qt5.15*; do
  if [ -d "$d" ]; then
    SDK_PATH="$d"
    break
  fi
done

# 如果没有找到标准目录名，取解压后的第一个子目录
if [ -z "$SDK_PATH" ]; then
  SDK_PATH=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | head -1)
fi

if [ -n "$SDK_PATH" ] \
  && [ -f "$SDK_PATH/bin/qmake" -o -f "$SDK_PATH/bin/qmake.exe" ]; then
  echo "QT5_12_OHOS_SDK=$SDK_PATH"
  echo ""
  echo "SDK 已就绪: $SDK_PATH"
else
  echo "无法定位解压后的 SDK 目录。请检查: $DEST"
  exit 1
fi
