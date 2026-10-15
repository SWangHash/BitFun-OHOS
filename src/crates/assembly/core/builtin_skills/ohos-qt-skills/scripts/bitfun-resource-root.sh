#!/bin/bash
# BitFun resource-root policy for the Qt migration acquisition scripts.
#
# BitFun scans `<qt_migration_root>/toolchains` and `<qt_migration_root>/templates`
# for the Qt migration intake candidates, and the runtime provisioner installs
# the managed kit into the same root. Every acquisition path must therefore
# resolve the root identically:
#
#   BITFUN_QT_MIGRATION_ROOT > --platform > host auto-detection
#
# The platform values are the layout tokens the runtime provisioner and the
# migration instructions use (`windows`, `macos`, `harmonyos`, `linux`).
#
# This file is BitFun-owned: it is sourced by the `bitfun-*` acquisition scripts
# and is never part of the pinned upstream knowledge baseline
# (`upstream-kb/**`), which the sync tooling owns byte for byte.
#
# The BitFun app injects both roots into every Bash tool command:
#   BITFUN_QT_MIGRATION_ROOT      -> shared Qt migration resource root
#   BITFUN_QT_MIGRATION_DOWNLOADS -> transfer cache (archives are not kept in the
#                                    install root)

# Browser-like User-Agent: GitCode answers 401 without one.
BITFUN_QT_CURL_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Storage namespace the BitFun app creates under the user root. Mirrors
# `data_namespace()` / the product definition's `dataNamespace`; the platform table
# below reproduces `PathManager::qt_migration_root_dir()` so a manual run and a
# model-run command resolve one root.
BITFUN_QT_DATA_NAMESPACE="bitfun"

# Echo the shared resource root for a layout platform token. An empty token means
# "detect the host"; an unknown token resolves to the Linux root, matching the
# layout table's own fallback. The injected `BITFUN_QT_MIGRATION_ROOT` always wins:
# the table is the manual-run fallback and says so on stderr.
bitfun_qt_resource_root() {
  local platform="${1:-}"
  if [ -n "${BITFUN_QT_MIGRATION_ROOT:-}" ]; then
    printf '%s\n' "$BITFUN_QT_MIGRATION_ROOT"
    return 0
  fi
  echo "注: 未注入 BITFUN_QT_MIGRATION_ROOT，按 --platform/主机探测解析资源根；应用内的 shell 一律拿到注入值。" >&2
  case "$platform" in
    macos)
      printf '%s\n' "${BITFUN_USER_ROOT:-${HOME}/Library/Application Support/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      ;;
    windows)
      printf '%s\n' "${BITFUN_USER_ROOT:-${APPDATA:-${HOME:-}/AppData/Roaming}/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      ;;
    harmonyos)
      printf '%s\n' "${BITFUN_USER_ROOT:-/data/storage/el2/base/files/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      ;;
    "")
      if [ "$(uname -s)" = "Darwin" ]; then
        printf '%s\n' "${BITFUN_USER_ROOT:-${HOME}/Library/Application Support/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      elif [ "${OSTYPE:-}" = "msys" ] || [ "${OSTYPE:-}" = "cygwin" ] || [ "${OS:-}" = "Windows_NT" ]; then
        printf '%s\n' "${BITFUN_USER_ROOT:-${APPDATA:-${HOME:-}/AppData/Roaming}/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      elif [ -f "/etc/ohos-release" ] || [ -f "/etc/openharmony-release" ] \
        || grep -qiE 'openharmony|harmonyos' /etc/os-release 2>/dev/null; then
        printf '%s\n' "${BITFUN_USER_ROOT:-/data/storage/el2/base/files/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      else
        printf '%s\n' "${BITFUN_USER_ROOT:-${XDG_DATA_HOME:-${HOME}/.local/share}/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      fi
      ;;
    *)
      printf '%s\n' "${BITFUN_USER_ROOT:-${XDG_DATA_HOME:-${HOME}/.local/share}/$BITFUN_QT_DATA_NAMESPACE}/data/qt-migration"
      ;;
  esac
}

# Echo the transfer cache for one resource kind (`toolchains` | `templates`).
# Archives land here and are removed after extraction, so the install root only
# ever holds reusable resources.
bitfun_qt_download_dir() {
  local kind="$1"
  if [ -n "${BITFUN_QT_MIGRATION_DOWNLOADS:-}" ]; then
    printf '%s\n' "$BITFUN_QT_MIGRATION_DOWNLOADS/$kind"
  else
    printf '%s\n' "${TMPDIR:-/tmp}/bitfun-qt-migration-downloads/$kind"
  fi
}
