#!/usr/bin/env sh
set -e

REPO="https://github.com/extole/extole-cli"
BIN_DIR="${EXTOLE_INSTALL:-/usr/local/bin}"

# Detect OS and architecture
platform=$(uname -ms)
case "$platform" in
  'Darwin arm64')               target=darwin-arm64 ;;
  'Darwin x86_64')              target=darwin-x64 ;;
  'Linux aarch64'|'Linux arm64') target=linux-arm64 ;;
  'Linux x86_64'|*)             target=linux-x64 ;;
esac

if [ -z "$target" ]; then
  echo "Unsupported platform: $platform"
  echo "Download manually from $REPO/releases"
  exit 1
fi

# Determine version
if [ -n "$1" ]; then
  version="$1"
  url="$REPO/releases/download/$version/extole-$target"
else
  url="$REPO/releases/latest/download/extole-$target"
fi

exe="$BIN_DIR/extole"

echo "Downloading extole ($target)..."

if command -v curl > /dev/null; then
  curl --fail --location --progress-bar --output "$exe" "$url"
elif command -v wget > /dev/null; then
  wget --quiet --show-progress --output-document="$exe" "$url"
else
  echo "Error: curl or wget is required"
  exit 1
fi

chmod +x "$exe"

echo ""
echo "extole installed to $exe"
echo "Run 'extole --help' to get started."
echo ""
echo "To authenticate: extole auth login --token YOUR_TOKEN"
