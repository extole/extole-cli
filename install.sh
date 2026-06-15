#!/usr/bin/env sh
set -e

REPO="https://github.com/extole/extole-cli"

if [ -n "$EXTOLE_INSTALL" ]; then
  BIN_DIR="$EXTOLE_INSTALL"
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="${HOME}/.local/bin"
  FALLBACK_INSTALL=1
fi

mkdir -p "$BIN_DIR"

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
if [ -n "$FALLBACK_INSTALL" ]; then
  echo ""
  echo "/usr/local/bin is not writable — using $BIN_DIR instead."
  echo "Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
fi
echo "Run 'extole --help' to get started."
echo ""
echo "To authenticate: extole auth login --token YOUR_TOKEN"
