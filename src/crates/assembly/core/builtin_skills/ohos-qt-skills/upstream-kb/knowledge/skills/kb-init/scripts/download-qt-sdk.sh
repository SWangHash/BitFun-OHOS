#!/bin/bash
# download-qt-sdk.sh — 下载 Qt OHOS 预编译 SDK
#
# 用法: bash skills/kb-init/scripts/download-qt-sdk.sh --platform=<macos|windows|linux> --dest=<目录>
# 输出: 下载并解压 SDK，输出 QT5_12_OHOS_SDK=<路径>
# 退出码: 0=成功, 1=失败

set -uo pipefail

PLATFORM=""
DEST=""

for arg in "$@"; do
  case "$arg" in
    --platform=*) PLATFORM="${arg#*=}";;
    --dest=*) DEST="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

if [ -z "$PLATFORM" ] || [ -z "$DEST" ]; then
  echo "用法: bash download-qt-sdk.sh --platform=<macos|windows|linux> --dest=<目录>"
  exit 2
fi

RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"

echo "--- Qt OHOS SDK 下载 ---"
echo "  平台: $PLATFORM"
echo "  目标: $DEST"
echo ""

# 创建目标目录
mkdir -p "$DEST"

# GitCode releases 页面 URL
echo "正在查询可用的 SDK 版本..."
echo ""

# 根据平台确定关键词
case "$PLATFORM" in
  macos)   KEYWORD="macos";;
  windows) KEYWORD="windows";;
  linux)   KEYWORD="linux";;
  *) echo "不支持的平台: $PLATFORM"; exit 1;;
esac

# 尝试通过 GitCode API 获取 release 信息
API_URL="https://gitcode.com/api/v5/repos/ohos-qt/qt-harmonyos-src/releases?per_page=10"
RELEASES_JSON=""
if command -v curl &>/dev/null; then
  RELEASES_JSON=$(curl -sL "$API_URL" 2>/dev/null || true)
elif command -v wget &>/dev/null; then
  RELEASES_JSON=$(wget -qO- "$API_URL" 2>/dev/null || true)
fi

# 解析 release assets
if [ -n "$RELEASES_JSON" ] && echo "$RELEASES_JSON" | grep -q "browser_download_url"; then
  echo "找到以下可用的 SDK 包："
  echo ""

  # 提取所有下载 URL 和名称
  DOWNLOAD_URLS=$(echo "$RELEASES_JSON" | grep -o '"browser_download_url":"[^"]*"' | sed 's/"browser_download_url":"//;s/"$//')
  ASSET_NAMES=$(echo "$RELEASES_JSON" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//')

  # 列出并匹配平台
  MATCHED_URL=""
  MATCHED_NAME=""
  INDEX=0
  while IFS= read -r url; do
    name=$(echo "$ASSET_NAMES" | sed -n "$((INDEX + 1))p")
    # 检查是否匹配平台
    if echo "$url" | grep -qi "$KEYWORD"; then
      echo "  [$INDEX] $name"
      echo "      $url"
      if [ -z "$MATCHED_URL" ]; then
        MATCHED_URL="$url"
        MATCHED_NAME="$name"
      fi
    fi
    INDEX=$((INDEX + 1))
  done <<< "$DOWNLOAD_URLS"

  if [ -z "$MATCHED_URL" ]; then
    echo ""
    echo "未找到匹配 $PLATFORM 平台的 SDK 包。"
    echo "请手动访问 $RELEASES_URL 下载。"
    exit 1
  fi

  echo ""
  echo "将下载: $MATCHED_NAME"
  echo "下载地址: $MATCHED_URL"
  echo ""
else
  echo "无法通过 API 获取 release 信息。"
  echo "请手动访问 $RELEASES_URL 下载对应平台的 SDK。"
  echo ""
  echo "下载后，将 SDK 解压到: $DEST"
  echo "然后重新运行初始化 skill。"
  exit 1
fi

# 下载
DOWNLOAD_FILE="$DEST/$MATCHED_NAME"
echo "正在下载..."
if command -v curl &>/dev/null; then
  curl -L -o "$DOWNLOAD_FILE" "$MATCHED_URL"
elif command -v wget &>/dev/null; then
  wget -O "$DOWNLOAD_FILE" "$MATCHED_URL"
fi

if [ ! -f "$DOWNLOAD_FILE" ]; then
  echo "下载失败。请手动下载: $MATCHED_URL"
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

if [ -n "$SDK_PATH" ]; then
  echo "QT5_12_OHOS_SDK=$SDK_PATH"
  echo ""
  echo "SDK 已就绪: $SDK_PATH"
else
  echo "无法定位解压后的 SDK 目录。请检查: $DEST"
  exit 1
fi
