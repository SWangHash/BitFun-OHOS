#!/bin/bash
# install-deveco-cli.sh — 自动安装 deveco-cli
#
# deveco-cli: 集成 HarmonyOS 应用开发工具集，提供知识文档和 Skills
# 仓库: https://gitcode.com/openharmony-sig/deveco-cli
#
# 安装方式:
#   1. npm 全局安装（推荐，需要 Node.js）
#   2. git clone + npm install（备用）
#
# 用法:
#   bash install-deveco-cli.sh [--method=npm|git] [--dest=<git clone 目录>]
#
# 退出码: 0=成功, 1=失败

set -uo pipefail

METHOD="npm"
DEST=""

for arg in "$@"; do
  case "$arg" in
    --method=*) METHOD="${arg#*=}" ;;
    --dest=*)   DEST="${arg#*=}" ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

echo "--- deveco-cli 安装 ---"
echo "  方式: $METHOD"
echo ""

if command -v deveco-cli &>/dev/null; then
  CURRENT_VER=$(deveco-cli --version 2>/dev/null || echo "unknown")
  echo "STATUS=already-installed"
  echo "DEVECO_CLI_VERSION=$CURRENT_VER"
  echo "deveco-cli 已安装: $CURRENT_VER"
  exit 0
fi

install_via_npm() {
  echo "方式 1: npm 全局安装"
  echo ""

  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm 未安装"
    echo "请先安装 Node.js (>= 18): https://nodejs.org/"
    return 1
  fi

  NODE_VER=$(node --version 2>/dev/null | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    echo "WARN: Node.js 版本过低 ($NODE_VER)，deveco-cli 需要 >= 18"
    echo "请升级 Node.js: https://nodejs.org/"
    return 1
  fi

  echo "Node.js: $NODE_VER"
  echo "运行: npm install -g deveco-cli"
  echo ""

  if npm install -g deveco-cli 2>&1; then
    if command -v deveco-cli &>/dev/null; then
      echo ""
      echo "STATUS=installed"
      echo "DEVECO_CLI_VERSION=$(deveco-cli --version 2>/dev/null || echo 'unknown')"
      echo "DEVECO_CLI_PATH=$(command -v deveco-cli)"
      return 0
    fi
  fi

  echo "npm 安装失败"
  return 1
}

install_via_git() {
  echo "方式 2: git clone + npm install"
  echo ""

  if ! command -v git &>/dev/null; then
    echo "ERROR: git 未安装"
    return 1
  fi

  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm 未安装"
    return 1
  fi

  CLONE_DIR="${DEST:-$HOME/dev/deveco-cli}"
  mkdir -p "$(dirname "$CLONE_DIR")"

  if [ -d "$CLONE_DIR/.git" ]; then
    echo "目录已存在，更新中: $CLONE_DIR"
    git -C "$CLONE_DIR" pull 2>&1
  else
    echo "克隆仓库: https://gitcode.com/openharmony-sig/deveco-cli.git"
    git clone https://gitcode.com/openharmony-sig/deveco-cli.git "$CLONE_DIR" 2>&1
  fi

  if [ ! -d "$CLONE_DIR" ]; then
    echo "ERROR: 克隆失败"
    return 1
  fi

  echo "安装依赖..."
  (cd "$CLONE_DIR" && npm install 2>&1)

  if [ -f "$CLONE_DIR/package.json" ]; then
    BIN_CMD=$(cd "$CLONE_DIR" && node -e "try{console.log(require('./package.json').bin&&Object.keys(require('./package.json').bin)[0]||'')}catch(e){}" 2>/dev/null)
    if [ -n "$BIN_CMD" ] && [ -f "$CLONE_DIR/node_modules/.bin/$BIN_CMD" ]; then
      echo ""
      echo "STATUS=installed-local"
      echo "DEVECO_CLI_DIR=$CLONE_DIR"
      echo "DEVECO_CLI_BIN=$CLONE_DIR/node_modules/.bin/$BIN_CMD"
      echo ""
      echo "建议创建全局链接："
      echo "  cd $CLONE_DIR && npm link"
      return 0
    fi
  fi

  echo ""
  echo "STATUS=cloned"
  echo "DEVECO_CLI_DIR=$CLONE_DIR"
  echo ""
  echo "仓库已克隆到 $CLONE_DIR，请查看 README 完成后续安装步骤。"
  return 0
}

case "$METHOD" in
  npm)
    if install_via_npm; then
      exit 0
    fi
    echo ""
    echo "npm 方式失败，尝试 git 方式..."
    echo ""
    if install_via_git; then
      exit 0
    fi
    ;;
  git)
    if install_via_git; then
      exit 0
    fi
    ;;
  *)
    echo "ERROR: 未知安装方式: $METHOD (可选: npm, git)"
    exit 1
    ;;
esac

echo ""
echo "STATUS=failed"
echo ""
echo "自动安装失败。请手动安装："
echo "  方式 1: npm install -g deveco-cli"
echo "  方式 2: git clone https://gitcode.com/openharmony-sig/deveco-cli.git && cd deveco-cli && npm install"
exit 1
