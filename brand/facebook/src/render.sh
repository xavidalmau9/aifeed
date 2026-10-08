#!/bin/bash
# usage: render.sh in.html out.png width height  — renders through the same headless-Chrome renderer the posts use (127.0.0.1:3000)
set -e
cp "$1" /tmp/index.html
code=$(curl -s -o "$2" -w "%{http_code}" -F "files=@/tmp/index.html;filename=index.html" -F width=$3 -F height=$4 -F waitDelay=1 http://127.0.0.1:3000/forms/chromium/screenshot/html)
[ "$code" = 200 ] || { echo "render failed $code"; cat "$2"; exit 1; }
echo "ok $2"
