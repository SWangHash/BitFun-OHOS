#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: verify-macos-microphone.sh <app-bundle>}"
entitlements_file="$(mktemp)"
trap 'rm -f "${entitlements_file}"' EXIT

# Inspect the signed bundle, not the source configuration: signing can lose entitlements.
codesign --display --entitlements - --xml "${app}" > "${entitlements_file}"
audio_input="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.device.audio-input' "${entitlements_file}" 2>/dev/null || true)"
if [[ "${audio_input}" != "true" ]]; then
  echo "Missing enabled Audio Input entitlement in signed app: ${app}" >&2
  exit 1
fi

usage_description="$(/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "${app}/Contents/Info.plist" 2>/dev/null || true)"
if [[ -z "${usage_description//[[:space:]]/}" ]]; then
  echo "Missing microphone usage description in app: ${app}" >&2
  exit 1
fi

echo "Verified microphone entitlement and usage description: ${app}"
