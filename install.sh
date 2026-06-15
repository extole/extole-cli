#!/usr/bin/env sh
set -e

REPO="https://github.com/extole/extole-cli"

# Choose install directory: explicit override, then a writable system dir, then a user dir.
if [ -n "$EXTOLE_INSTALL" ]; then
  BIN_DIR="$EXTOLE_INSTALL"
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="$HOME/.local/bin"
fi

mkdir -p "$BIN_DIR"

# Detect OS and architecture
platform=$(uname -ms)
case "$platform" in
  'Darwin arm64')                target=darwin-arm64 ;;
  'Darwin x86_64')               target=darwin-x64 ;;
  'Linux aarch64'|'Linux arm64') target=linux-arm64 ;;
  'Linux x86_64'|*)              target=linux-x64 ;;
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

# Ensure the install directory is on PATH for future shells.
case ":$PATH:" in
  *":$BIN_DIR:"*)
    on_path=1 ;;
  *)
    on_path=0 ;;
esac

if [ "$on_path" -eq 0 ]; then
  path_line="export PATH=\"$BIN_DIR:\$PATH\""

  shell_name=$(basename "${SHELL:-sh}")
  case "$shell_name" in
    zsh)
      profile="$HOME/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        profile="$HOME/.bash_profile"
      else
        profile="$HOME/.bashrc"
      fi ;;
    *)
      profile="$HOME/.profile" ;;
  esac

  if grep -Fq "$BIN_DIR" "$profile" 2>/dev/null; then
    profile_has_path=1
  else
    printf '\n# Added by extole-cli installer\n%s\n' "$path_line" >> "$profile"
    profile_has_path=0
  fi

  echo ""
  if [ "$profile_has_path" -eq 0 ]; then
    echo "Added $BIN_DIR to your PATH in $profile."
  else
    echo "$BIN_DIR is referenced in $profile but not on the current PATH."
  fi
  echo "Open a new terminal, or run this in the current one:"
  echo "  $path_line"
fi

echo ""
echo "Run 'extole --help' to get started."
echo ""
echo "To authenticate: extole auth login --token YOUR_TOKEN"
