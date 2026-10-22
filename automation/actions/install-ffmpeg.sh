#!/usr/bin/env bash
# Pinned static ffmpeg (johnvansickle 7.0.2 amd64, GPL-3). The post job must not apt-get
# install ffmpeg: on 2026-10-22 that step took 36 minutes and the 45-minute job timeout
# cancelled the run after the site publish, leaving the slot claimed with no social posts.
set -euo pipefail

VER=7.0.2
SHA=abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67
URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-${VER}-amd64-static.tar.xz"
DEST="${AIFEED_FFMPEG_DIR:-$HOME/.cache/aifeed-ffmpeg}"

mkdir -p "$DEST"
if [[ ! -x "$DEST/ffmpeg" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL --retry 4 --retry-delay 2 "$URL" -o "$tmp"
  echo "${SHA}  ${tmp}" | sha256sum -c -
  tar -xJf "$tmp" -C "$DEST" --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
  chmod 755 "$DEST/ffmpeg" "$DEST/ffprobe"
  rm -f "$tmp"
  trap - EXIT
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$DEST" >> "$GITHUB_PATH"
fi

set +o pipefail
line="$("$DEST/ffmpeg" -version | head -n 1)"
set -o pipefail
echo "$line"
case "$line" in
  *"ffmpeg version ${VER}-static"*) ;;
  *) echo "unexpected ffmpeg build: $line" >&2; exit 1 ;;
esac
