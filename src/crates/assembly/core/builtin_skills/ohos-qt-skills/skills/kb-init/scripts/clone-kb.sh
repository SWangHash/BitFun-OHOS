#!/bin/bash
# clone-kb.sh — 下载 Qt for HarmonyOS 知识库
#
# 用法: bash skills/kb-init/scripts/clone-kb.sh --dest=<父目录>
# 输出: KB_ROOT=<知识库路径>
# 退出码: 0=成功, 1=失败

set -uo pipefail

DEST=""
for arg in "$@"; do
  case "$arg" in
    --dest=*) DEST="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

if [ -z "$DEST" ]; then
  echo "用法: bash clone-kb.sh --dest=<父目录>"
  echo "  知识库将被克隆到 <父目录>/ohos_qt-skills/"
  exit 2
fi

KB_URL="https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git"
KB_DIR="$DEST/ohos_qt-skills"

echo "--- 下载知识库 ---"
echo "  URL: $KB_URL"
echo "  目标: $KB_DIR"
echo ""

if [ -d "$KB_DIR" ]; then
  echo "知识库目录已存在: $KB_DIR"
  echo "KB_ROOT=$KB_DIR"
  exit 0
fi

mkdir -p "$DEST"

if ! command -v git &>/dev/null; then
  echo "FAIL: git 未安装"
  echo "  macOS: xcode-select --install"
  echo "  Windows: https://git-scm.com/download/win"
  echo "  Linux: sudo apt install git"
  exit 1
fi

echo "正在克隆..."
git clone "$KB_URL" "$KB_DIR" 2>&1
rc=$?
if [ $rc -ne 0 ]; then
  echo ""
  echo "FAIL: 克隆失败 (exit $rc)"
  echo "  请检查网络连接，或手动运行:"
  echo "  git clone $KB_URL $KB_DIR"
  exit 1
fi

echo ""
echo "KB_ROOT=$KB_DIR"
echo "知识库下载完成: $KB_DIR"
