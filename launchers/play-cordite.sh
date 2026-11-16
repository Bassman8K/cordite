#!/bin/sh
# Builds and starts the CORDITE desktop app from this checkout (Linux).
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is needed. Get it from https://nodejs.org and run this again."
  printf "Press Return to close."; read -r _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies..."
  npm ci || { printf "Install failed. Press Return to close."; read -r _; exit 1; }
fi
npm run desktop
