#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 Jire
#
# Installs, updates or removes the Taskbar Media Controls GNOME Shell
# extension for the current user. No root needed.
#
#   curl -fsSL https://raw.githubusercontent.com/Jire/taskbar-media-controls/main/install.sh | bash
#   wget -qO- https://raw.githubusercontent.com/Jire/taskbar-media-controls/main/install.sh | bash
#
# Options (append after "bash -s --"):
#   --uninstall        remove the extension
#   --version vX.Y     install a specific release instead of the latest
#   --zip FILE         install from a local zip (as built by scripts/build.sh)

set -euo pipefail

REPO="Jire/taskbar-media-controls"
UUID="taskbar-media-controls@jire.github.io"
ZIP_NAME="$UUID.shell-extension.zip"
MIN_SHELL=46
EXT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
EXT_DIR="$EXT_ROOT/$UUID"

if [ -t 1 ]; then
    BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
    BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi
info() { printf '%s==>%s %s\n' "$BOLD$GREEN" "$RESET" "$*"; }
warn() { printf '%swarning:%s %s\n' "$BOLD$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$BOLD$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

download() { # url dest
    if have curl; then
        curl -fsSL --retry 3 -o "$2" "$1"
    elif have wget; then
        wget -q -O "$2" "$1"
    else
        die "need curl or wget to download the extension"
    fi
}

extract() { # zip destdir
    if have unzip; then
        unzip -qo "$1" -d "$2"
    elif have bsdtar; then
        bsdtar -xf "$1" -C "$2"
    elif have python3; then
        python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"
    else
        die "need gnome-extensions, unzip, bsdtar or python3 to unpack the extension"
    fi
}

enabled_list() { gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]"; }

enable_extension() {
    # gnome-extensions enable talks to the running shell, which on Wayland
    # does not see newly installed extensions until the next login, so also
    # write the setting directly.
    gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
    local current
    current=$(enabled_list)
    if [[ "$current" != *"'$UUID'"* ]]; then
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']"
        fi
    fi
}

disable_extension() {
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    local current
    current=$(enabled_list)
    if [[ "$current" == *"'$UUID'"* ]]; then
        current=${current//", '$UUID'"/}
        current=${current//"'$UUID', "/}
        current=${current//"'$UUID'"/}
        gsettings set org.gnome.shell enabled-extensions "$current"
    fi
}

reload_hint() {
    if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
        echo "  Restart GNOME Shell to load it: press Alt+F2, type r, press Enter."
    else
        echo "  Log out and back in to load it (GNOME on Wayland only loads new extensions at login)."
        echo "  To load it right now instead, see \"Load without logging out\" in the README."
    fi
}

distro_family() {
    local id="" like=""
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        id="${ID:-}" like="${ID_LIKE:-}"
    fi
    case " $id $like " in
        *" arch "*) echo arch ;;
        *" fedora "*|*" rhel "*) echo fedora ;;
        *" ubuntu "*|*" debian "*) echo debian ;;
        *) echo other ;;
    esac
}

dash_to_panel_hint() {
    local dtp="dash-to-panel@jderose9.github.com"
    if [ -d "$EXT_ROOT/$dtp" ] || [ -d "/usr/share/gnome-shell/extensions/$dtp" ] ||
       [ -d "/usr/local/share/gnome-shell/extensions/$dtp" ]; then
        return
    fi
    echo
    echo "  Optional: the hover-preview buttons need the Dash to Panel extension, which"
    echo "  isn't installed. The Quick Settings media card works without it. To add it:"
    case "$(distro_family)" in
        arch)   echo "    sudo pacman -S gnome-shell-extension-dash-to-panel" ;;
        fedora) echo "    sudo dnf install gnome-shell-extension-dash-to-panel" ;;
        debian) echo "    sudo apt install gnome-shell-extension-dash-to-panel" ;;
    esac
    echo "    or: https://extensions.gnome.org/extension/1160/dash-to-panel/"
}

uninstall() {
    disable_extension
    if have gnome-extensions && gnome-extensions uninstall "$UUID" >/dev/null 2>&1; then
        :
    fi
    rm -rf "$EXT_DIR"
    info "Removed $UUID."
    echo "  It stays active in the current session until you log out."
    exit 0
}

# ---------------------------------------------------------------------------

VERSION="latest"
LOCAL_ZIP=""
while [ $# -gt 0 ]; do
    case "$1" in
        --uninstall) ACTION=uninstall ;;
        --version) VERSION="${2:?--version needs a tag, e.g. v1}"; shift ;;
        --zip) LOCAL_ZIP="${2:?--zip needs a file}"; shift ;;
        -h|--help)
            cat <<'USAGE'
Usage: install.sh [--uninstall] [--version vX] [--zip FILE]
  (no options)    install or update to the latest release
  --uninstall     remove the extension
  --version vX    install a specific release tag
  --zip FILE      install from a local zip built by scripts/build.sh
USAGE
            exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

[ "$(id -u)" -ne 0 ] || die "run this as your normal user, not with sudo (it installs into your home folder)"
have gsettings || die "gsettings not found; is this a GNOME desktop?"

if [ "${ACTION:-}" = uninstall ]; then
    uninstall
fi

if have gnome-shell; then
    shell_major=$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -n1)
    if [ -n "$shell_major" ] && [ "$shell_major" -lt "$MIN_SHELL" ]; then
        die "GNOME Shell $shell_major is too old; version $MIN_SHELL or newer is required"
    fi
else
    warn "gnome-shell not found on PATH; installing anyway"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "$LOCAL_ZIP" ]; then
    cp "$LOCAL_ZIP" "$tmp/$ZIP_NAME"
else
    if [ "$VERSION" = latest ]; then
        url="https://github.com/$REPO/releases/latest/download/$ZIP_NAME"
    else
        url="https://github.com/$REPO/releases/download/$VERSION/$ZIP_NAME"
    fi
    info "Downloading $url"
    download "$url" "$tmp/$ZIP_NAME" || die "download failed"
fi

was_installed=0
[ -d "$EXT_DIR" ] && was_installed=1

if have gnome-extensions && gnome-extensions install --force "$tmp/$ZIP_NAME" 2>/dev/null; then
    :
else
    rm -rf "$EXT_DIR"
    mkdir -p "$EXT_DIR"
    extract "$tmp/$ZIP_NAME" "$EXT_DIR"
fi
[ -f "$EXT_DIR/metadata.json" ] || die "install failed: $EXT_DIR/metadata.json is missing"

enable_extension

if [ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" = "true" ]; then
    warn "user extensions are switched off on this system. Turn them on in the Extensions app,"
    warn "or run: gsettings set org.gnome.shell disable-user-extensions false"
fi

if [ "$was_installed" -eq 1 ]; then
    info "Updated Taskbar Media Controls in $EXT_DIR"
else
    info "Installed Taskbar Media Controls to $EXT_DIR"
fi
reload_hint
dash_to_panel_hint
echo
echo "  Enjoying it? Star the repo and follow @Jire on GitHub for more free tools:"
echo "    https://github.com/Jire/taskbar-media-controls"
