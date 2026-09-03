#!/bin/bash
# clone-qt-src.sh — 克隆 Qt 鸿蒙源码
#
# 用法: bash skills/kb-init/scripts/clone-qt-src.sh \
#         --method=<commercial|opensource> \
#         --version=<5.12|5.15> \
#         --dest=<目录> \
#         [--user=<用户名>] [--pass=<密码>]
# 输出: QT5_12_SRC=<路径> 和/或 QT5_15_SRC=<路径>
# 退出码: 0=成功, 1=失败

set -uo pipefail

METHOD=""
VERSION="5.12"
DEST=""
QT_USER=""
QT_PASS=""

for arg in "$@"; do
  case "$arg" in
    --method=*) METHOD="${arg#*=}";;
    --version=*) VERSION="${arg#*=}";;
    --dest=*) DEST="${arg#*=}";;
    --user=*) QT_USER="${arg#*=}";;
    --pass=*) QT_PASS="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

if [ -z "$METHOD" ] || [ -z "$DEST" ]; then
  echo "用法: bash clone-qt-src.sh --method=<commercial|opensource> --version=<5.12|5.15> --dest=<目录> [--user=<用户名>] [--pass=<密码>]"
  exit 2
fi

echo "--- Qt 源码克隆 ---"
echo "  方式: $METHOD"
echo "  版本: $VERSION"
echo "  目标: $DEST"
echo ""

mkdir -p "$DEST"

# 检查 git
if ! command -v git &>/dev/null; then
  echo "FAIL: git 未安装"
  exit 1
fi

# 检查 git 配置
GIT_NAME=$(git config --global user.name 2>/dev/null || true)
GIT_EMAIL=$(git config --global user.email 2>/dev/null || true)
if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
  echo "FAIL: git user.name 或 user.email 未配置"
  echo "  git config --global user.name \"你的名字\""
  echo "  git config --global user.email \"你的邮箱\""
  exit 1
fi

clone_repo() {
  local url="$1" branch="$2" target="$3" label="$4"

  if [ -d "$target/qtbase" ]; then
    echo "  已存在: $target (跳过)"
    return 0
  fi

  echo "  正在克隆 $label ..."
  # 隐藏 URL 中的凭据（如果有）
  local _safe_url
  _safe_url=$(echo "$url" | sed 's|://[^@]*@|://***@|')
  echo "  URL: $_safe_url"
  echo "  分支: $branch"
  echo ""

  git clone --branch "$branch" --single-branch "$url" "$target" 2>&1
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "FAIL: 克隆失败 (exit $rc)"
    return 1
  fi

  echo ""
  echo "  正在初始化子模块..."
  (cd "$target" && git submodule update --init --recursive 2>&1)
  rc=$?
  [ $rc -ne 0 ] && echo "WARN: 子模块初始化失败 (exit $rc)"

  echo "  克隆完成: $target"
  return 0
}

# 确定 URL 和分支
case "$METHOD" in
  commercial)
    if [ -n "$QT_USER" ] && [ -n "$QT_PASS" ]; then
      REPO_URL="https://${QT_USER}:${QT_PASS}@codereview.qt-project.org/qt/tqtc-qt5"
    else
      REPO_URL="https://codereview.qt-project.org/qt/tqtc-qt5"
    fi
    BRANCH_512="tqtc/harmonyos-5.12.12"
    BRANCH_515="tqtc/harmonyos-5.15.16"
    ;;
  opensource)
    REPO_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src.git"
    BRANCH_512="5.12.12"
    BRANCH_515="5.15.16"
    ;;
  *)
    echo "FAIL: 不支持的获取方式: $METHOD"
    exit 1
    ;;
esac

QT5_12_SRC=""
QT5_15_SRC=""

case "$VERSION" in
  5.12)
    clone_repo "$REPO_URL" "$BRANCH_512" "$DEST/qt5.12" "Qt 5.12.12" || exit 1
    QT5_12_SRC="$DEST/qt5.12"
    ;;
  5.15)
    clone_repo "$REPO_URL" "$BRANCH_515" "$DEST/qt5.15" "Qt 5.15.16" || exit 1
    QT5_15_SRC="$DEST/qt5.15"
    ;;
  both)
    clone_repo "$REPO_URL" "$BRANCH_512" "$DEST/qt5.12" "Qt 5.12.12" || exit 1
    QT5_12_SRC="$DEST/qt5.12"
    clone_repo "$REPO_URL" "$BRANCH_515" "$DEST/qt5.15" "Qt 5.15.16" || exit 1
    QT5_15_SRC="$DEST/qt5.15"
    ;;
  *)
    echo "FAIL: 不支持的版本: $VERSION"
    exit 1
    ;;
esac

echo ""
echo "--- 结果 ---"
[ -n "$QT5_12_SRC" ] && echo "QT5_12_SRC=$QT5_12_SRC"
[ -n "$QT5_15_SRC" ] && echo "QT5_15_SRC=$QT5_15_SRC"
echo ""
echo "源码克隆完成。"
