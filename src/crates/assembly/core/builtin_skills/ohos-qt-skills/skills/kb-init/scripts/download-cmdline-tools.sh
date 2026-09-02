#!/bin/bash
# download-cmdline-tools.sh — 自动下载并安装 HarmonyOS Command Line Tools
#
# 用法:
#   bash download-cmdline-tools.sh --dest=<安装目录> [--url=<自定义下载URL>]
#
# 支持平台: macOS, Windows (Git Bash), Linux
# HarmonyOS: 不支持自动下载，脚本会输出申请指引
#
# 退出码: 0=成功, 1=参数错误, 2=下载失败, 3=平台不支持

set -uo pipefail

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
  echo "ERROR: 必须指定 --dest=<安装目录>"
  echo "用法: bash download-cmdline-tools.sh --dest=<安装目录> [--url=<下载URL>]"
  exit 1
fi

detect_os() {
  if [ -d "/storage/Users/currentUser/.harmonybrew" ] || { command -v brew &>/dev/null && brew --prefix 2>/dev/null | grep -q harmonybrew; }; then
    echo "harmonyos"; return
  fi
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)
      if [ -f "/etc/ohos-release" ] || [ -f "/etc/openharmony-release" ] || grep -qi "openharmony\|harmonyos" /etc/os-release 2>/dev/null; then
        echo "harmonyos"
      else
        echo "linux"
      fi ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

OS=$(detect_os)
ARCH=$(uname -m)

echo "--- Command Line Tools for HarmonyOS 下载 ---"
echo "  平台: $OS ($ARCH)"
echo "  目标: $DEST"
echo ""

if [ "$OS" = "harmonyos" ]; then
  echo "STATUS=unsupported"
  echo ""
  echo "HarmonyOS 平台当前不支持自动下载 Command Line Tools。"
  echo ""
  echo "获取方式："
  echo "  1. 访问 HarmonyOS 开发者官网统一工单平台: https://developer.huawei.com/consumer/cn/"
  echo "  2. 提交工单申请 Command Line Tools for HarmonyOS 遥测版本"
  echo "  3. 获得下载链接后，使用 --url 参数重新运行本脚本："
  echo "     bash download-cmdline-tools.sh --dest=$DEST --url=<下载链接>"
  echo ""
  echo "也可以手动下载后解压到: $DEST"
  exit 3
fi

DOWNLOAD_URL=""
ARCHIVE_NAME=""

if [ -n "$CUSTOM_URL" ]; then
  DOWNLOAD_URL="$CUSTOM_URL"
  ARCHIVE_NAME=$(basename "$CUSTOM_URL")
else
  DOWNLOAD_PAGE="https://developer.huawei.com/consumer/cn/download/"
  case "$OS" in
    macos)
      if [ "$ARCH" = "arm64" ]; then
        ARCHIVE_NAME="commandline-tools-mac-arm64.tar.gz"
      else
        ARCHIVE_NAME="commandline-tools-mac-x64.tar.gz"
      fi ;;
    windows)
      ARCHIVE_NAME="commandline-tools-windows-x64.zip" ;;
    linux)
      ARCHIVE_NAME="commandline-tools-linux-x64.tar.gz" ;;
  esac
  echo "STATUS=need-manual"
  echo ""
  echo "无法自动获取下载链接。请按以下步骤操作："
  echo "  1. 访问 $DOWNLOAD_PAGE"
  echo "  2. 找到 Command Line Tools for HarmonyOS"
  echo "  3. 下载 $(echo "$ARCHIVE_NAME" | sed 's/-/ /g') 版本"
  echo "  4. 将下载的文件路径传给本脚本："
  echo "     bash download-cmdline-tools.sh --dest=$DEST --url=file:///path/to/$ARCHIVE_NAME"
  echo ""
  echo "或者使用 --url 参数直接指定下载链接："
  echo "  bash download-cmdline-tools.sh --dest=$DEST --url=<下载链接>"
  exit 2
fi

mkdir -p "$DEST"

echo "下载中: $DOWNLOAD_URL"
TMPFILE=$(mktemp)
if curl -fSL --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"; then
  echo "下载完成"
else
  echo "ERROR: 下载失败: $DOWNLOAD_URL"
  rm -f "$TMPFILE"
  exit 2
fi

echo "解压中..."
case "$ARCHIVE_NAME" in
  *.tar.gz|*.tgz)
    tar xzf "$TMPFILE" -C "$DEST" ;;
  *.zip)
    unzip -q -o "$TMPFILE" -d "$DEST" ;;
  *)
    echo "ERROR: 未知归档格式: $ARCHIVE_NAME"
    rm -f "$TMPFILE"
    exit 1 ;;
esac
rm -f "$TMPFILE"

echo "解压完成: $DEST"

SDK_NATIVE=""
TOOLCHAINS=""
CLI_PATH=""

for d in "$DEST" "$DEST"/*; do
  [ -d "$d/sdk/default/openharmony/native" ] && SDK_NATIVE="$d/sdk/default/openharmony/native"
  [ -d "$d/sdk/default/openharmony/toolchains" ] && TOOLCHAINS="$d/sdk/default/openharmony/toolchains"
  { [ -f "$d/tools/devecocli" ] || [ -f "$d/tools/devecocli.bat" ]; } && CLI_PATH="$d/tools"
done

echo ""
echo "STATUS=installed"
echo "CLT_ROOT=$DEST"
[ -n "$SDK_NATIVE" ] && echo "OHOS_SDK_NATIVE=$SDK_NATIVE"
[ -n "$TOOLCHAINS" ] && echo "TOOLCHAINS=$TOOLCHAINS"
[ -n "$CLI_PATH" ] && echo "DEVECO_CLI_DIR=$CLI_PATH"

echo ""
echo "建议将以下路径加入 PATH："
[ -n "$TOOLCHAINS" ] && echo "  export PATH=\"$TOOLCHAINS:\$PATH\""
[ -n "$CLI_PATH" ] && echo "  export PATH=\"$CLI_PATH:\$PATH\""
[ -n "$SDK_NATIVE" ] && echo "  export OHOS_SDK_NATIVE=\"$SDK_NATIVE\""
