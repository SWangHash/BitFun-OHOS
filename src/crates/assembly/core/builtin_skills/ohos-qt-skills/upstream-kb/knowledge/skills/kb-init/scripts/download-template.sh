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
#   bash download-template.sh --dest=<目录> [--url=<自定义下载URL>]
#
# 退出码: 0=成功, 1=参数错误, 2=下载失败

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
  echo "ERROR: 必须指定 --dest=<目录>"
  echo "用法: bash download-template.sh --dest=<目录> [--url=<下载URL>]"
  exit 1
fi

RELEASES_URL="https://gitcode.com/ohos-qt/qt-harmonyos-src/releases"
ARCHIVE_NAME="templates-0625.zip"

echo "--- 鸿蒙工程模板下载 ---"
echo "  目标: $DEST"
echo "  归档: $ARCHIVE_NAME"
echo ""

if [ -d "$DEST/entry" ] && [ -f "$DEST/build-profile.json5" ]; then
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
  API_URL="https://gitcode.com/api/v5/repos/ohos-qt/qt-harmonyos-src/releases"
  echo "查询 releases API: $API_URL"
  ASSET_URL=$(curl -fsSL "$API_URL" 2>/dev/null | \
    grep -o "\"browser_download_url\":\"[^\"]*${ARCHIVE_NAME}\"" | \
    head -1 | \
    sed 's/"browser_download_url":"//;s/"$//')

  if [ -n "$ASSET_URL" ]; then
    DOWNLOAD_URL="$ASSET_URL"
  else
    echo "STATUS=need-manual"
    echo ""
    echo "无法自动获取下载链接。请手动操作："
    echo "  1. 访问 $RELEASES_URL"
    echo "  2. 找到 $ARCHIVE_NAME 并下载"
    echo "  3. 将下载文件路径传给本脚本："
    echo "     bash download-template.sh --dest=$DEST --url=file:///path/to/$ARCHIVE_NAME"
    echo ""
    echo "或手动解压到: $DEST"
    exit 2
  fi
fi

echo "下载中: $DOWNLOAD_URL"
TMPFILE=$(mktemp)
if curl -fSL --progress-bar -o "$TMPFILE" "$DOWNLOAD_URL"; then
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

if [ -d "$DEST/entry" ] && [ -f "$DEST/build-profile.json5" ]; then
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
