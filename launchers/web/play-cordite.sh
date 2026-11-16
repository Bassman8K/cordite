#!/bin/sh
# Serves this folder on your own machine and opens CORDITE in the browser (macOS and Linux).
cd "$(dirname "$0")" || exit 1
PORT=4173
URL="http://127.0.0.1:$PORT/"
if [ ! -f index.html ]; then
  echo "Put this script next to the game's index.html and run it again."
  exit 1
fi
if command -v python3 >/dev/null 2>&1; then
  set -- python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v npx >/dev/null 2>&1; then
  set -- npx --yes serve -l "$PORT" .
else
  echo "Python 3 or Node.js is needed to serve the game. Install either one and run this again."
  exit 1
fi
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
) &
echo "CORDITE is running at $URL"
echo "Close this window, or press Ctrl+C, to stop."
exec "$@"
