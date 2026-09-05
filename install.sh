#!/usr/bin/env bash
#  Usage: bash install.sh [--no-backup] [--keyboard=LAYOUT]

set -euo pipefail
IFS=$'\n\t'
umask 077

# Colors
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'; BOLD='\033[1m'

info()   { echo -e "${B}[INFO]${N}  $*"; }
ok()     { echo -e "${G}[ OK ]${N}  $*"; }
warn()   { echo -e "${Y}[WARN]${N}  $*"; }
err()    { echo -e "${R}[ERR ]${N}  $*" >&2; }
header() { echo -e "\n${BOLD}${C}|  $*  |${N}"; }
step()   { echo -e "${BOLD}  ▸ $*${N}"; }

usage() {
    cat <<'EOF'
Usage: install.sh [--no-backup] [--keyboard=LAYOUT]

Options:
  --no-backup
            Do not retain previous dotfiles below XDG_STATE_HOME.
  --keyboard=LAYOUT
            Set the XKB keyboard layout used by Hyprland. Defaults to latam.
            Comma-separated layouts such as us,latam are accepted.
  -h, --help
            Show this.
EOF
}

NO_BACKUP=0
KEYBOARD_LAYOUT="latam"
KEYBOARD_EXPLICIT=0

valid_keyboard_layout() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*(,[A-Za-z0-9][A-Za-z0-9_-]*)*$ ]]
}

keyboard_layout_from_file() {
    local file="$1" layout=""
    [[ -r "$file" ]] || return 1
    layout="$(sed -nE 's/^[[:space:]]*return[[:space:]]*\{[[:space:]]*layout[[:space:]]*=[[:space:]]*"([A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*)"[[:space:]]*\}[[:space:]]*$/\1/p' "$file")"
    [[ -n "$layout" ]] && valid_keyboard_layout "$layout" || return 1
    printf '%s\n' "$layout"
}

parse_install_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-backup)
                NO_BACKUP=1
                ;;
            --keyboard=*)
                KEYBOARD_LAYOUT="${1#*=}"
                valid_keyboard_layout "$KEYBOARD_LAYOUT" || {
                    printf 'install.sh: invalid keyboard layout: %s\n' "$KEYBOARD_LAYOUT" >&2
                    return 2
                }
                KEYBOARD_EXPLICIT=1
                ;;
            -h | --help)
                usage
                return 10
                ;;
            *)
                printf 'install.sh: unknown option: %s\n\n' "$1" >&2
                usage >&2
                return 2
                ;;
        esac
        shift
    done
}

[[ ${HOME:-} == /* ]] || {
    printf 'install.sh: HOME must be set to an absolute path.\n' >&2
    exit 1
}

xdg_dir_or_default() {
    local configured="${1:-}" fallback="$2"
    if [[ "$configured" == /* ]]; then
        printf '%s\n' "$configured"
    else
        printf '%s\n' "$fallback"
    fi
}

REPO_URL="https://github.com/finixtavh/fndots.git"
CHROMA_URL="https://github.com/yuri-xyz/chroma.git"
CHROMA_COMMIT="27edb09e55ad45d69602cd2a0b67e00d9faf1d60"
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P)"
CLONE_DIR="$HOME/.fndots"
FN_APPS_DIR="$HOME/fn-apps"
DOTFILES="$CLONE_DIR"
CFG="$(xdg_dir_or_default "${XDG_CONFIG_HOME:-}" "$HOME/.config")"
STATE_HOME="$(xdg_dir_or_default "${XDG_STATE_HOME:-}" "$HOME/.local/state")"
DATA_HOME="$(xdg_dir_or_default "${XDG_DATA_HOME:-}" "$HOME/.local/share")"
BACKUP_ROOT="$STATE_HOME/fndots/backups/$(date +%Y%m%d-%H%M%S)-$$"


check_arch_host() {
    local os_id="" os_like=""
    [[ $EUID -ne 0 ]] || { err "Run as your normal user, not root."; return 1; }
    [[ "$(uname -s)" == "Linux" ]] || { err "Arch Linux only."; return 1; }
    [[ "$(uname -m)" == "x86_64" ]] || {
        err "This installer supports Arch Linux x86_64 only."
        return 1
    }
    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        os_id="${ID:-}"
        os_like="${ID_LIKE:-}"
    fi
    [[ " $os_id $os_like " == *" arch "* ]] || {
        err "This installer requires Arch Linux or an Arch-based distribution."
        return 1
    }
    command -v pacman &>/dev/null || {
        err "pacman not found this script is made for Arch Linux."
        return 1
    }
    command -v sudo &>/dev/null || { err "sudo not found."; return 1; }
}

STAGED_PATH=""
DEPLOY_TRANSACTION_ACTIVE=0
TRANSACTION_TARGETS=()
TRANSACTION_BACKUPS=()

same_path() {
    [[ "$(realpath -m -- "$1")" == "$(realpath -m -- "$2")" ]]
}

backup_path_for() {
    local dst="$1"
    if [[ "$dst" == "$HOME" ]]; then
        printf '%s/home\n' "$BACKUP_ROOT"
    elif [[ "$dst" == "$HOME/"* ]]; then
        printf '%s/home/%s\n' "$BACKUP_ROOT" "${dst#"$HOME"/}"
    else
        printf '%s/rootfs/%s\n' "$BACKUP_ROOT" "${dst#/}"
    fi
}

recovery_path_for() {
    local dst="$1"
    if [[ "$dst" == "$HOME" ]]; then
        printf '%s/failed-new/home\n' "$BACKUP_ROOT"
    elif [[ "$dst" == "$HOME/"* ]]; then
        printf '%s/failed-new/home/%s\n' "$BACKUP_ROOT" "${dst#"$HOME"/}"
    else
        printf '%s/failed-new/rootfs/%s\n' "$BACKUP_ROOT" "${dst#/}"
    fi
}

transient_backup_for() {
    local dst="$1" parent base holder
    parent="$(dirname -- "$dst")"
    base="$(basename -- "$dst")"
    holder="$(mktemp -d "$parent/.${base}.fndots.rollback.XXXXXX")" || return 1
    printf '%s/original\n' "$holder"
}

discard_transient_backup() {
    local backup="$1" holder
    [[ -n "$backup" && "$(basename -- "$backup")" == "original" ]] || {
        err "Refusing to remove an invalid temporary rollback path."
        return 1
    }
    holder="$(dirname -- "$backup")"
    case "$(basename -- "$holder")" in
        .*\.fndots.rollback.*)
            rm -rf -- "$holder"
            ;;
        *)
            err "Refusing to remove unexpected rollback path: $holder"
            return 1
            ;;
    esac
}

rollback_deploy_transaction() {
    [[ $DEPLOY_TRANSACTION_ACTIVE -eq 1 ]] || return 0
    DEPLOY_TRANSACTION_ACTIVE=0
    trap - EXIT HUP INT TERM

    warn "Deployment failed; restoring every target changed in this run..."
    local i dst backup recovery holder moved_new
    for ((i=${#TRANSACTION_TARGETS[@]} - 1; i >= 0; i--)); do
        dst="${TRANSACTION_TARGETS[i]}"
        backup="${TRANSACTION_BACKUPS[i]}"
        moved_new=1

        if [[ $NO_BACKUP -eq 1 ]]; then
            if [[ -z "$backup" ]]; then
                err "Missing temporary rollback path for $dst; leaving it untouched."
                continue
            fi
            holder="$(dirname -- "$backup")"
            if [[ "$(basename -- "$backup")" != "original" ]] ||
               [[ "$(basename -- "$holder")" != .*\.fndots.rollback.* ]]; then
                err "Invalid temporary rollback path for $dst; leaving it untouched."
                continue
            fi
            if [[ -e "$dst" || -L "$dst" ]]; then
                if ! mv -- "$dst" "$holder/rejected"; then
                    err "Could not move the rejected deployment away from $dst."
                    moved_new=0
                fi
            fi
            if [[ $moved_new -eq 1 && ( -e "$backup" || -L "$backup" ) ]]; then
                mkdir -p -- "$(dirname -- "$dst")" || moved_new=0
                if [[ $moved_new -eq 1 ]] && mv -- "$backup" "$dst"; then
                    ok "Restored $dst"
                else
                    err "Could not restore $dst; its original remains at $backup."
                    moved_new=0
                fi
            fi
            if [[ $moved_new -eq 1 ]]; then
                discard_transient_backup "$backup" || true
            fi
            continue
        fi

        if [[ -e "$dst" || -L "$dst" ]]; then
            recovery="$(recovery_path_for "$dst")"
            mkdir -p -- "$(dirname -- "$recovery")" || moved_new=0
            if [[ $moved_new -eq 1 ]] && ! mv -- "$dst" "$recovery"; then
                err "Could not preserve the rejected deployment at $recovery."
                moved_new=0
            fi
        fi

        if [[ -n "$backup" && $moved_new -eq 1 ]]; then
            mkdir -p -- "$(dirname -- "$dst")" || {
                err "Could not recreate the destination parent for $dst."
                continue
            }
            if mv -- "$backup" "$dst"; then
                ok "Restored $dst"
            else
                err "Could not restore $dst; its backup remains at $backup."
            fi
        fi
    done
    TRANSACTION_TARGETS=()
    TRANSACTION_BACKUPS=()
}

transaction_exit_guard() {
    local status=$?
    rollback_deploy_transaction
    exit "$status"
}

begin_deploy_transaction() {
    [[ $DEPLOY_TRANSACTION_ACTIVE -eq 0 ]] || {
        err "A deployment transaction is already active."
        return 1
    }
    DEPLOY_TRANSACTION_ACTIVE=1
    TRANSACTION_TARGETS=()
    TRANSACTION_BACKUPS=()
    trap transaction_exit_guard EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
}

secure_deploy_state() {
    local state_root="$STATE_HOME/fndots"
    mkdir -p -- "$state_root" || {
        err "Could not create deployment state: $state_root"
        return 1
    }
    chmod 700 -- "$state_root" || {
        err "Could not protect deployment state directories."
        return 1
    }
    if [[ $NO_BACKUP -eq 0 ]]; then
        mkdir -p -- "$state_root/backups" || {
            err "Could not create deployment backup state: $state_root/backups"
            return 1
        }
        chmod 700 -- "$state_root/backups" || {
            err "Could not protect deployment backup state."
            return 1
        }
    fi
    find "$state_root" -type d -exec chmod 700 -- {} + || return 1
    find "$state_root" -type f -exec chmod go-rwx -- {} + || return 1
}

commit_deploy_transaction() {
    [[ $DEPLOY_TRANSACTION_ACTIVE -eq 1 ]] || return 0
    local backups=("${TRANSACTION_BACKUPS[@]}")
    DEPLOY_TRANSACTION_ACTIVE=0
    TRANSACTION_TARGETS=()
    TRANSACTION_BACKUPS=()
    trap - EXIT HUP INT TERM
    if [[ $NO_BACKUP -eq 1 ]]; then
        local backup
        for backup in "${backups[@]}"; do
            discard_transient_backup "$backup" || return 1
        done
    fi
}

stage_tree() {
    local src="$1" dst="$2" parent base
    STAGED_PATH=""
    [[ -d "$src" ]] || { err "Missing source directory: $src"; return 1; }

    parent="$(dirname -- "$dst")"
    base="$(basename -- "$dst")"
    mkdir -p -- "$parent" || {
        err "Could not create destination parent: $parent"
        return 1
    }
    if ! STAGED_PATH="$(mktemp -d "$parent/.${base}.fndots.new.XXXXXX")"; then
        err "Could not create a staging directory beside $dst."
        STAGED_PATH=""
        return 1
    fi

    if ! cp -a -- "$src/." "$STAGED_PATH/"; then
        err "Could not stage $src for installation."
        rm -rf -- "$STAGED_PATH"
        STAGED_PATH=""
        return 1
    fi
}

activate_staged_path() {
    local staged="$1" dst="$2" backup=""

    if [[ $NO_BACKUP -eq 1 ]]; then
        if ! backup="$(transient_backup_for "$dst")"; then
            err "Could not create temporary rollback storage for $dst."
            rm -rf -- "$staged"
            return 1
        fi
    fi

    if [[ -e "$dst" || -L "$dst" ]]; then
        if [[ $NO_BACKUP -eq 0 ]]; then
            backup="$(backup_path_for "$dst")"
        fi
        mkdir -p -- "$(dirname -- "$backup")" || {
            err "Could not create the backup directory for $dst."
            if [[ $NO_BACKUP -eq 1 ]]; then
                discard_transient_backup "$backup" || true
            fi
            rm -rf -- "$staged"
            return 1
        }
        if [[ $NO_BACKUP -eq 1 ]]; then
            step "Hold $dst temporarily for rollback"
        else
            step "Preserve $dst → $backup"
        fi
        if ! mv -- "$dst" "$backup"; then
            err "Could not preserve $dst; leaving it untouched."
            if [[ $NO_BACKUP -eq 1 ]]; then
                discard_transient_backup "$backup" || true
            fi
            rm -rf -- "$staged"
            return 1
        fi
    fi

    if ! mv -- "$staged" "$dst"; then
        err "Could not activate $dst."
        if [[ -n "$backup" ]]; then
            warn "Restoring the previous $dst..."
            if [[ -e "$backup" || -L "$backup" ]]; then
                mv -- "$backup" "$dst" || err "Automatic restore failed; recover it from $backup."
            fi
            if [[ $NO_BACKUP -eq 1 && ! -e "$backup" && ! -L "$backup" ]]; then
                discard_transient_backup "$backup" || true
            fi
        fi
        rm -rf -- "$staged"
        return 1
    fi

    if [[ $DEPLOY_TRANSACTION_ACTIVE -eq 1 ]]; then
        TRANSACTION_TARGETS+=("$dst")
        TRANSACTION_BACKUPS+=("$backup")
    elif [[ $NO_BACKUP -eq 1 ]]; then
        discard_transient_backup "$backup" || return 1
    fi

    ok "Installed $dst"
}

deploy_tree() {
    local src="$1" dst="$2"
    if same_path "$src" "$dst"; then
        ok "$dst is already the source checkout; no copy needed"
        return 0
    fi
    stage_tree "$src" "$dst" || return 1
    activate_staged_path "$STAGED_PATH" "$dst" || return 1
}

deploy_overlay_tree() {
    local src="$1" dst="$2" parent base
    if same_path "$src" "$dst"; then
        ok "$dst is already the source checkout; no copy needed"
        return 0
    fi
    [[ -d "$src" ]] || { err "Missing source directory: $src"; return 1; }

    parent="$(dirname -- "$dst")"
    base="$(basename -- "$dst")"
    mkdir -p -- "$parent" || {
        err "Could not create destination parent: $parent"
        return 1
    }
    if ! STAGED_PATH="$(mktemp -d "$parent/.${base}.fndots.new.XXXXXX")"; then
        err "Could not create a staging directory beside $dst."
        STAGED_PATH=""
        return 1
    fi

    if [[ -d "$dst" ]] && ! cp -a -- "$dst/." "$STAGED_PATH/"; then
        err "Could not stage existing user data from $dst."
        rm -rf -- "$STAGED_PATH"
        STAGED_PATH=""
        return 1
    fi
    if ! cp -a -- "$src/." "$STAGED_PATH/"; then
        err "Could not overlay $src onto the staged user data."
        rm -rf -- "$STAGED_PATH"
        STAGED_PATH=""
        return 1
    fi
    activate_staged_path "$STAGED_PATH" "$dst" || return 1
}

deploy_file() {
    local src="$1" dst="$2" mode="$3" parent base staged
    [[ -f "$src" ]] || { err "Missing source file: $src"; return 1; }
    if same_path "$src" "$dst"; then
        chmod "$mode" -- "$dst" || return 1
        return 0
    fi

    parent="$(dirname -- "$dst")"
    base="$(basename -- "$dst")"
    mkdir -p -- "$parent" || {
        err "Could not create destination parent: $parent"
        return 1
    }
    if ! staged="$(mktemp "$parent/.${base}.fndots.new.XXXXXX")"; then
        err "Could not create a staged file beside $dst."
        return 1
    fi
    if ! install -m"$mode" -- "$src" "$staged"; then
        rm -f -- "$staged"
        return 1
    fi
    activate_staged_path "$staged" "$dst" || return 1
}

pkg_installed() { pacman -Qi "$1" &>/dev/null; }

upgrade_arch_system() {
    header "Full Arch system upgrade"
    info "Synchronizing repositories and upgrading the complete system..."
    sudo pacman -Syu --noconfirm
    ok "System packages are fully synchronized"
}

install_pacman() {
    local needed=()
    for p in "$@"; do pkg_installed "$p" || needed+=("$p"); done
    [[ ${#needed[@]} -eq 0 ]] && return 0
    info "pacman -S: ${needed[*]}"
    sudo pacman -S --needed --noconfirm "${needed[@]}"
}

install_aur() {
    local needed=()
    for p in "$@"; do pkg_installed "$p" || needed+=("$p"); done
    [[ ${#needed[@]} -eq 0 ]] && return 0
    info "yay -S: ${needed[*]}"
    yay -S --needed --noconfirm "${needed[@]}"
}

install_yay() {
    header "yay"
    install_pacman git base-devel
    if command -v yay &>/dev/null; then
        ok "yay already installed ($(yay --version | head -1))"
        return 0
    fi
    info "Installing yay from AUR..."
    local tmp; tmp=$(mktemp -d)
    trap "rm -rf '$tmp'" EXIT
    git clone --depth=1 https://aur.archlinux.org/yay.git "$tmp/yay"
    (cd "$tmp/yay" && makepkg -si --noconfirm)
    trap - EXIT
    rm -rf "$tmp"
    ok "yay installed"
}

# System dependencies, btw i have to remove many dependencies
install_deps() {
    header "System packages (pacman)"

    install_pacman \
        base-devel git curl wget mold \
        \
        hyprland xdg-desktop-portal-hyprland hyprlock hyprpicker \
        \
        pipewire pipewire-alsa pipewire-pulse wireplumber \
        gst-plugin-pipewire \
        \
        playerctl brightnessctl pavucontrol 7zip libarchive \
        \
        grim slurp swappy wl-clipboard cliphist \
        \
        kitty thunar firefox kate \
        \
        libnotify \
        \
        mpv ffmpeg awww \
        alsa-lib libpulse vulkan-icd-loader \
        \
        gjs gtk3 gtk-layer-shell gobject-introspection \
        dart-sass \
        \
        xdg-user-dirs xdg-utils jq python lua libxml2 desktop-file-utils yt-dlp rofi qt6ct \
        fontconfig librsvg hypridle hyprsunset \
        \
        zsh starship pyenv fzf lsd bat jdk25-openjdk \
        zsh-autosuggestions zsh-history-substring-search zsh-syntax-highlighting \
        \
        woff2-font-awesome ttf-jetbrains-mono-nerd \
        noto-fonts noto-fonts-emoji noto-fonts-cjk \
        \
        polkit-kde-agent \
        gnome-system-monitor \
        \
        iwd bluez bluez-utils

    
    command -v cargo &>/dev/null || install_pacman rust

    header "AUR packages (yay)"


    install_aur \
        aylurs-gtk-shell \
        libastal-git \
        libastal-4-git \
        libastal-apps-git \
        libastal-bluetooth-git \
        libastal-wifi-git \
        libastal-hyprland-git \
        libastal-mpris-git \
        libastal-notifd-git \
        libastal-tray-git \
        libastal-wireplumber-git \
        mpvpaper \
        bibata-cursor-theme-bin \
        pyenv-virtualenv \
        zsh-sudo \
        zsh-auto-notify

    ok "All dependencies installed"
}

install_oh_my_zsh() {
    header "oh-my-zsh"
    local omz_dir="$HOME/.oh-my-zsh"
    if [[ -d "$omz_dir" ]]; then
        ok "oh-my-zsh already installed ($omz_dir)"
        return 0
    fi
    info "Installing oh-my-zsh (unattended)..."
    local omz_installer=""
    omz_installer="$(mktemp --suffix=-oh-my-zsh-install.sh)" || {
        err "Could not create a temporary file for the oh-my-zsh installer."
        return 1
    }
    if curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh -o "$omz_installer" \
        && [[ -s "$omz_installer" ]] \
        && KEEP_ZSHRC=yes RUNZSH=no CHSH=no sh "$omz_installer" "" --unattended; then
        rm -f -- "$omz_installer" || true
        ok "oh-my-zsh installed to $omz_dir"
    else
        rm -f -- "$omz_installer" || true
        err "oh-my-zsh installation failed."
        return 1
    fi
}

validate_runtime_versions() {
    local hypr_version="" ags_version=""
    hypr_version="$(Hyprland --version-json 2>/dev/null | jq -r '.version // empty')"
    [[ "$hypr_version" == 0.56.* ]] || {
        err "Unsupported Hyprland version: ${hypr_version:-unknown}; expected 0.56.x."
        return 1
    }
    ags_version="$(ags --version 2>/dev/null || true)"
    [[ "$ags_version" =~ (^|[^0-9])3\.[0-9] ]] || {
        err "Unsupported AGS version: ${ags_version:-unknown}; expected AGS v3."
        return 1
    }
    ok "Compatible runtime detected: Hyprland $hypr_version; $ags_version"
}

keyboard_layout_available() {
    local value="$1"
    local layout
    local -a layouts=()
    local IFS=','
    read -r -a layouts <<< "$value"
    for layout in "${layouts[@]}"; do
        if [[ ! -f "/usr/share/X11/xkb/symbols/$layout" ]]; then
            return 1
        fi
    done
}

validate_keyboard_layout() {
    if ! keyboard_layout_available "$KEYBOARD_LAYOUT"; then
        err "Unknown XKB keyboard layout in: $KEYBOARD_LAYOUT"
        err "Choose layouts present under /usr/share/X11/xkb/symbols."
        return 1
    fi
    ok "Keyboard layout is available: $KEYBOARD_LAYOUT"
}

require_network_stack() {
    local missing=()
    command -v iwctl &>/dev/null || missing+=("iwd")
    if [[ ! -x /usr/lib/bluetooth/bluetoothd ]] && ! command -v bluetoothd &>/dev/null; then
        missing+=("bluez bluez-utils")
    fi
    pkg_installed libastal-wifi-git || missing+=("libastal-wifi-git")
    pkg_installed libastal-bluetooth-git || missing+=("libastal-bluetooth-git")
    if (( ${#missing[@]} > 0 )); then
        err "Missing required Wi-Fi/Bluetooth dependencies: ${missing[*]}."
        return 1
    fi
    ok "Wi-Fi/Bluetooth stack present (iwd, BlueZ, libastal-wifi, libastal-bluetooth)"
}

# Clone repo 
is_dotfiles_origin() {
    case "$1" in
        "$REPO_URL"|"${REPO_URL%.git}"|"git@github.com:finixtavh/fndots.git"|"ssh://git@github.com/finixtavh/fndots.git")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

clone_dotfiles() {
    header "Locate dotfiles"
    local checkout_root origin

    checkout_root="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -n "$checkout_root" && -f "$checkout_root/install.sh" ]] &&
       same_path "$checkout_root/install.sh" "$SCRIPT_PATH"; then
        DOTFILES="$checkout_root"
        ok "Using local checkout at $DOTFILES"
        return 0
    fi

    if [[ -d "$CLONE_DIR/.git" ]]; then
        origin="$(git -C "$CLONE_DIR" remote get-url origin 2>/dev/null || true)"
        is_dotfiles_origin "$origin" || {
            err "$CLONE_DIR is not a clone of $REPO_URL."
            err "Move it elsewhere, then run this installer again."
            return 1
        }
        info "Updating existing clone..."
        git -C "$CLONE_DIR" pull --ff-only
    elif [[ -e "$CLONE_DIR" ]]; then
        err "$CLONE_DIR exists but is not a Git checkout."
        err "Move it elsewhere, then run this installer again."
        exit 1
    else
        git clone "$REPO_URL" "$CLONE_DIR"
    fi

    DOTFILES="$CLONE_DIR"
    ok "Dotfiles at $DOTFILES"
}

validate_dotfiles_source() {
    local rel missing=0
    local required_dirs=(
        configs/ags configs/hypr configs/rofi
        configs/zsh configs/starship configs/xdg configs/thunar
        assets/lyrics assets/wallpapers/desktop
        assets/wallpapers/terminal apps/fnsession apps/fnnetspeed apps/fnwall
    )
    local required_files=(
        install.sh
        update.sh
        configs/zsh/.zshrc
        configs/starship/starship.toml
        configs/xdg/mimeapps.list
        configs/thunar/appimage-run.desktop
        configs/thunar/scripts/appimage-run
        configs/thunar/scripts/extract-here
        configs/ags/app.ts
        configs/ags/style.scss
        configs/ags/user-settings.json
        configs/ags/widget/Helpers/Paths.ts
        configs/ags/scripts/battery-limit.sh
        configs/hypr/hyprland.lua
        configs/hypr/keyboard.lua
        configs/hypr/paths.lua
        configs/hypr/user_settings.lua
        configs/hypr/animations.lua
        configs/hypr/rules.lua
        configs/hypr/keybinds.lua
        configs/zsh/functions/fnctl
        apps/fnsession/fnsession
        apps/fnsession/README.md
        apps/fnnetspeed/fnnetspeed
        apps/fnwall/wallpicker.sh
        apps/fnwall/restore.sh
    )

    for rel in "${required_dirs[@]}"; do
        if [[ ! -d "$DOTFILES/$rel" ]]; then
            err "Required directory is missing from the checkout: $rel/"
            missing=1
        fi
    done
    for rel in "${required_files[@]}"; do
        if [[ ! -f "$DOTFILES/$rel" ]]; then
            err "Required file is missing from the checkout: $rel"
            missing=1
        fi
    done

    [[ $missing -eq 0 ]] || {
        err "The dotfiles checkout is incomplete; no live configuration was changed."
        return 1
    }
    ok "Required dotfile sources are present"
}

verify_icon_stack() {
    local family
    family="$(fc-match -f '%{family}\n' 'JetBrainsMono Nerd Font' 2>/dev/null | head -n 1)"
    [[ "$family" == *Nerd* || "$family" == *" NF"* ]] || {
        err "JetBrainsMono Nerd Font was installed but fontconfig cannot resolve it."
        return 1
    }
    gjs "$DOTFILES/configs/ags/scripts/verify-icons.js" || {
        err "GdkPixbuf cannot render the SVG icon set."
        return 1
    }
    ok "Nerd Font glyphs and SVG icons are available"
}

is_chroma_origin() {
    case "$1" in
        "$CHROMA_URL"|"${CHROMA_URL%.git}"|"git@github.com:yuri-xyz/chroma.git"|"ssh://git@github.com/yuri-xyz/chroma.git")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Chroma
install_chroma() {
    header "Installing Chroma"

    local source_dir="$FN_APPS_DIR/chroma"
    local origin status
    mkdir -p "$FN_APPS_DIR"

    if [[ -d "$source_dir/.git" ]]; then
        origin=$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)
        is_chroma_origin "$origin" || {
            err "$source_dir is not a clone of $CHROMA_URL."
            err "Move it elsewhere, then run this installer again."
            return 1
        }

        status="$(git -C "$source_dir" status --porcelain --untracked-files=normal)" || return 1
        if [[ -n "$status" ]]; then
            err "$source_dir has local changes; refusing to overwrite them."
            return 1
        fi
        info "Fetching the pinned Chroma revision..."
        git -C "$source_dir" fetch origin "$CHROMA_COMMIT"
    elif [[ -e "$source_dir" ]]; then
        err "$source_dir exists but is not a Git checkout."
        err "Move it elsewhere, then run this installer again."
        return 1
    else
        info "Cloning $CHROMA_URL → $source_dir..."
        git clone "$CHROMA_URL" "$source_dir"
    fi

    git -C "$source_dir" cat-file -e "$CHROMA_COMMIT^{commit}" 2>/dev/null || {
        err "Pinned Chroma revision is unavailable: $CHROMA_COMMIT"
        return 1
    }
    git -C "$source_dir" checkout --detach "$CHROMA_COMMIT"

    cargo install --locked --force \
        --root "$HOME/.local" \
        --path "$source_dir"

    [[ -x "$HOME/.local/bin/chroma" ]] || {
        err "Chroma was built but is missing from ~/.local/bin."
        return 1
    }
    ok "Installed Chroma at $HOME/.local/bin/chroma"
}

deploy_fnsession() {
    local source_dir="$DOTFILES/apps/fnsession"
    [[ -f "$source_dir/fnsession" ]] || {
        err "Missing fnsession source: $source_dir/fnsession"
        return 1
    }
    [[ -f "$source_dir/README.md" ]] || {
        err "Missing fnsession documentation: $source_dir/README.md"
        return 1
    }

    deploy_file "$source_dir/fnsession" "$HOME/.local/bin/fnsession" 755 || return 1
    ok "Installed fnsession at $HOME/.local/bin/fnsession"
}

deploy_fnnetspeed() {
    local source_dir="$DOTFILES/apps/fnnetspeed"
    local app_dir="$FN_APPS_DIR/fnnetspeed"
    [[ -f "$source_dir/fnnetspeed" ]] || {
        err "Missing fnnetspeed source: $source_dir/fnnetspeed"
        return 1
    }

    deploy_tree "$source_dir" "$app_dir" || return 1
    chmod 755 -- "$app_dir/fnnetspeed" || {
        err "Could not make $app_dir/fnnetspeed executable."
        return 1
    }
    deploy_file "$app_dir/fnnetspeed" "$HOME/.local/bin/fnnetspeed" 755 || return 1
    ok "Installed fnnetspeed at $HOME/.local/bin/fnnetspeed"
}

deploy_fnwall() {
    local source_dir="$DOTFILES/apps/fnwall"
    local app_dir="$FN_APPS_DIR/fnwall"
    [[ -f "$source_dir/wallpicker.sh" && -f "$source_dir/restore.sh" ]] || {
        err "Missing FNWall sources in $source_dir"
        return 1
    }

    migrate_legacy_fnwall_dir || return 1
    migrate_fnwall_state || return 1
    deploy_config_tree fnwall "$source_dir" "$app_dir" || return 1
    ok "Installed FNWall at $app_dir"
}

install_battery_limit_helper() {
    local source="$DOTFILES/configs/ags/scripts/battery-limit.sh"
    [[ -f "$source" ]] || {
        err "Missing battery limit helper source: $source"
        return 1
    }
    if ! sudo install -Dm0755 -- "$source" /usr/local/libexec/ags-battery-limit; then
        err "Could not install the root-owned battery limit helper."
        return 1
    fi
    [[ "$(stat -c '%u:%a' /usr/local/libexec/ags-battery-limit)" == "0:755" ]] || {
        err "Battery limit helper is not root-owned mode 0755."
        return 1
    }
    if ! cmp -s -- "$source" /usr/local/libexec/ags-battery-limit; then
        err "Installed battery limit helper does not match the managed source."
        return 1
    fi
    ok "Installed root-owned battery limit helper"
}

# fnsession 
install_fn_apps() {
    header "FN applications | FNSession & FNWall"
    deploy_fnsession || return 1
    deploy_fnnetspeed || return 1
    deploy_fnwall
}
validate_ags_dir() {
    local ags_dir="$1"
    command -v ags &>/dev/null || {
        err "The aylurs-gtk-shell package did not provide /usr/bin/ags."
        return 1
    }
    command -v sass &>/dev/null || {
        err "dart-sass is installed, but its sass command was not found."
        return 1
    }
    [[ -d /usr/share/ags/js ]] || {
        err "The AGS JavaScript runtime is missing from /usr/share/ags/js."
        return 1
    }

    local js_out="" css_out=""
    if ! js_out="$(mktemp --suffix=.js)"; then
        err "Could not create a temporary AGS bundle."
        return 1
    fi
    if ! css_out="$(mktemp --suffix=.css)"; then
        rm -f -- "$js_out" || true
        err "Could not create a temporary stylesheet."
        return 1
    fi
    if ! (
        cd "$ags_dir" &&
        ags bundle app.ts "$js_out" -g 3 &&
        sass style.scss "$css_out" --style=compressed --no-source-map
    ); then
        rm -f -- "$js_out" "$css_out" || true
        err "AGS configuration validation failed."
        return 1
    fi
    rm -f -- "$js_out" "$css_out" || {
        err "Could not remove temporary AGS validation files."
        return 1
    }
    ok "AGS TypeScript and SCSS compile successfully"
}

validate_zsh_sources() {
    command -v zsh &>/dev/null || {
        err "zsh is installed but its command was not found."
        return 1
    }
    zsh -n "$DOTFILES/configs/zsh/.zshrc" || {
        err "The managed .zshrc has a syntax error."
        return 1
    }
    zsh -n "$DOTFILES/configs/zsh/functions/fnctl" || {
        err "The managed fnctl function has a syntax error."
        return 1
    }
    ok "Zsh configuration parses successfully"
}

validate_starship_config() {
    local config_file="$1" starship_bin="/usr/bin/starship" active_starship=""
    [[ -x "$starship_bin" ]] || {
        err "The pacman Starship binary is unavailable; run install.sh first."
        return 1
    }
    STARSHIP_CONFIG="$config_file" "$starship_bin" print-config >/dev/null || {
        err "The managed Starship configuration is invalid."
        return 1
    }
    active_starship="$(command -v starship 2>/dev/null || true)"
    if [[ -n "$active_starship" && "$active_starship" != "$starship_bin" ]]; then
        warn "$active_starship shadows pacman's $starship_bin in PATH."
    fi
    ok "Starship configuration parses successfully"
}

validate_user_assets() {
    validate_zsh_sources || return 1
    validate_starship_config "$DOTFILES/configs/starship/starship.toml" || return 1
}

deploy_thunar_integration() {
    deploy_file "$DOTFILES/configs/thunar/scripts/appimage-run" \
        "$HOME/.local/bin/appimage-run" 755 || return 1
    deploy_file "$DOTFILES/configs/thunar/scripts/extract-here" \
        "$HOME/.local/bin/extract-here" 755 || return 1
    deploy_file "$DOTFILES/configs/thunar/appimage-run.desktop" \
        "$DATA_HOME/applications/appimage-run.desktop" 644 || return 1
    if command -v update-desktop-database &>/dev/null; then
        update-desktop-database "$DATA_HOME/applications" || return 1
    fi
    ok "Installed Thunar AppImage integration in $DATA_HOME/applications"
}

configure_appimage_mime() {
    command -v xdg-mime &>/dev/null || {
        err "xdg-mime is unavailable; AppImage associations were not changed."
        return 1
    }
    xdg-mime default appimage-run.desktop application/vnd.appimage || return 1
    xdg-mime default appimage-run.desktop application/x-iso9660-appimage || return 1
    ok "Associated AppImage MIME types without replacing other user defaults"
}

migrate_legacy_fnwall_dir() {
    local legacy_dir="$CFG/wallman"
    local app_dir="$FN_APPS_DIR/fnwall"

    [[ -e "$legacy_dir" || -L "$legacy_dir" ]] || return 0
    if [[ -e "$app_dir" || -L "$app_dir" ]]; then
        warn "Both $legacy_dir and $app_dir exist; leaving the legacy directory untouched."
        return 0
    fi
    mkdir -p -- "$FN_APPS_DIR" || return 1
    mv -- "$legacy_dir" "$app_dir" || {
        err "Could not move the legacy Wallman directory to $app_dir"
        return 1
    }
    ok "Moved legacy Wallman files to $app_dir"
}

migrate_fnwall_state() {
    local state_dir="$STATE_HOME/fnwall"
    local state_file="$state_dir/current"
    local source_state="" wallpaper="" staged=""
    local candidate

    [[ -e "$state_file" ]] && return 0
    for candidate in \
        "$STATE_HOME/wallman/current" \
        "$FN_APPS_DIR/fnwall/current" \
        "$CFG/wallman/current"; do
        if [[ -s "$candidate" ]]; then
            source_state="$candidate"
            break
        fi
    done
    [[ -n "$source_state" ]] || return 0

    IFS= read -r wallpaper < "$source_state" || true
    if [[ "$wallpaper" == "$CFG/wallman/"* ]]; then
        wallpaper="$FN_APPS_DIR/fnwall/${wallpaper#"$CFG/wallman/"}"
    fi
    if [[ "$wallpaper" != /* || ! -f "$wallpaper" ]]; then
        warn "Ignoring stale FNWall state from $source_state"
        return 0
    fi
    mkdir -p -- "$state_dir" || {
        err "Could not create FNWall state directory: $state_dir"
        return 1
    }
    staged="$(mktemp "$state_dir/.current.XXXXXX")" || return 1
    if ! printf '%s\n' "$wallpaper" > "$staged" ||
       ! chmod 600 -- "$staged" ||
       ! mv -- "$staged" "$state_file"; then
        rm -f -- "$staged"
        err "Could not migrate FNWall state."
        return 1
    fi
    ok "Migrated FNWall state to $state_file"
}

prepare_config_stage() {
    local rel="$1" current="$2" staged="$3" settings_tmp preserved_layout

    case "$rel" in
        ags)

            rm -rf -- "$staged/node_modules" "$staged/scripts/__pycache__" || return 1
            rm -f -- "$staged/package-lock.json" || return 1
            find "$staged" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete || return 1

            if [[ -f "$current/user-settings.json" ]]; then
                if ! cp -a -- "$current/user-settings.json" "$staged/user-settings.json"; then
                    err "Could not preserve AGS user settings."
                    return 1
                fi
                ok "Preserved AGS user settings"
            fi
            settings_tmp="$(mktemp "$staged/.user-settings.XXXXXX")" || return 1
            if ! jq 'del(.networkBackend, .networkBackendCached, .networkAutoCache)' \
                "$staged/user-settings.json" > "$settings_tmp"; then
                rm -f -- "$settings_tmp"
                err "Could not remove obsolete network backend settings."
                return 1
            fi
            mv -- "$settings_tmp" "$staged/user-settings.json" || return 1
            chmod 600 -- "$staged/user-settings.json" || {
                err "Could not protect staged AGS user settings."
                return 1
            }
            validate_ags_dir "$staged" || return 1
            ;;
        hypr)
            if [[ $KEYBOARD_EXPLICIT -eq 1 ]]; then
                printf 'return { layout = "%s" }\n' "$KEYBOARD_LAYOUT" > "$staged/keyboard.lua" || return 1
            elif preserved_layout="$(keyboard_layout_from_file "$current/keyboard.lua" 2>/dev/null)" &&
                 keyboard_layout_available "$preserved_layout"; then
                cp -a -- "$current/keyboard.lua" "$staged/keyboard.lua" || {
                    err "Could not preserve the configured keyboard layout."
                    return 1
                }
                KEYBOARD_LAYOUT="$preserved_layout"
            elif [[ -e "$current/keyboard.lua" ]]; then
                warn "Ignoring an invalid existing keyboard.lua; using $KEYBOARD_LAYOUT."
            fi
            chmod 644 -- "$staged/keyboard.lua" || return 1
            if [[ -d "$staged/scripts" ]]; then
                find "$staged/scripts" -type f -name '*.sh' -exec chmod +x {} \; || return 1
            fi
            mkdir -p -- "$staged/chroma" || return 1
            if ! cp -a -- "$DOTFILES/assets/chroma/." "$staged/chroma/"; then
                err "Could not stage the managed Chroma presets."
                return 1
            fi
            ;;
        zsh)
            rm -f -- "$staged/.zshrc" || return 1
            ;;
        fnwall)

            mkdir -p -- "$staged/wallpapers" "$staged/terminal_wallpapers" || return 1
            if ! cp -a -- "$DOTFILES/assets/wallpapers/desktop/." "$staged/wallpapers/"; then
                err "Could not stage the managed desktop wallpapers."
                return 1
            fi
            if ! cp -a -- "$DOTFILES/assets/wallpapers/terminal/." "$staged/terminal_wallpapers/"; then
                err "Could not stage the managed terminal wallpapers."
                return 1
            fi
            rm -f -- "$staged/wallpapers/.gitkeep" "$staged/terminal_wallpapers/.gitkeep" || return 1
            if [[ -d "$current/wallpapers" ]]; then
                if ! cp -a -- "$current/wallpapers/." "$staged/wallpapers/"; then
                    err "Could not preserve existing wallpapers."
                    return 1
                fi
                ok "Preserved existing wallpapers"
            fi
            if [[ -d "$current/terminal_wallpapers" ]]; then
                if ! cp -a -- "$current/terminal_wallpapers/." "$staged/terminal_wallpapers/"; then
                    err "Could not preserve existing terminal wallpapers."
                    return 1
                fi
                ok "Preserved existing terminal wallpapers"
            fi
            rm -f -- "$staged/current" || return 1
            find "$staged" -type f -name '*.sh' -exec chmod +x {} \; || return 1
            ;;
    esac
    return 0
}

deploy_config_tree() {
    local rel="$1" src="$2" dst="$3"
    if same_path "$src" "$dst"; then
        ok "$dst is already the source checkout; no copy needed"
        if [[ "$rel" == "ags" ]]; then
            validate_ags_dir "$src" || return 1
        fi
        return 0
    fi

    stage_tree "$src" "$dst" || return 1
    if ! prepare_config_stage "$rel" "$dst" "$STAGED_PATH"; then
        err "Staged $rel configuration failed validation; live files were not changed."
        rm -rf -- "$STAGED_PATH"
        STAGED_PATH=""
        return 1
    fi
    activate_staged_path "$STAGED_PATH" "$dst" || return 1
}

# Install 
install_configs() {
    header "Install config files"
    local rel dst
    local required_dirs=(ags hypr rofi zsh thunar)
    local optional_dirs=(kitty dunst gtk-3.0 gtk-4.0 Kvantum)

    for rel in "${required_dirs[@]}"; do
        dst="$CFG/$rel"
        [[ "$rel" != "thunar" ]] || dst="$CFG/Thunar"
        deploy_config_tree "$rel" "$DOTFILES/configs/$rel" "$dst" || return 1
    done

    for rel in "${optional_dirs[@]}"; do
        if [[ -d "$DOTFILES/configs/$rel" ]]; then
            deploy_config_tree "$rel" "$DOTFILES/configs/$rel" "$CFG/$rel" || return 1
        else
            info "Optional config not present: $rel/"
        fi
    done

    ok "FNWall wallpapers ready in $FN_APPS_DIR/fnwall/wallpapers"
}

install_user_assets() {
    header "User files and desktop integrations"
    deploy_file "$DOTFILES/configs/zsh/.zshrc" "$HOME/.zshrc" 644 || return 1
    deploy_file "$DOTFILES/configs/starship/starship.toml" "$CFG/starship.toml" 644 || return 1
    deploy_thunar_integration || return 1
    deploy_overlay_tree "$DOTFILES/assets/lyrics" "$HOME/lyrics" || return 1
    ok "Installed user files and merged managed lyrics"
}

#  disable hardware power key shutdown
configure_logind() {
    header "systemd-logind power key config"
    local dir="/etc/systemd/logind.conf.d"
    local file="$dir/10-power-key.conf"
    local expected=$'[Login]\nHandlePowerKey=ignore'

    if [[ -f "$file" ]] && [[ "$(sudo cat "$file" 2>/dev/null)" == "$expected" ]]; then
        ok "Power key config is already correct"
        return 0
    fi

    info "Setting HandlePowerKey=ignore (prevents double-shutdown with AGS power menu)"
    if ! sudo mkdir -p "$dir"; then
        err "Could not create $dir."
        return 1
    fi
    if ! printf '%s\n' "$expected" | sudo tee "$file" > /dev/null; then
        err "Could not write $file."
        return 1
    fi
    if [[ "$(sudo cat "$file" 2>/dev/null)" != "$expected" ]]; then
        err "$file does not contain the expected power-key policy."
        return 1
    fi
    ok "HandlePowerKey=ignore written; it will take effect after reboot"
}

# Enable services 
enable_services() {
    header "Available services"

    local svc failed=0
    for svc in pipewire.socket pipewire-pulse.socket wireplumber.service; do
        if systemctl --user enable --now "$svc"; then
            ok "$svc enabled and started"
        else
            err "Could not enable $svc for the current user."
            failed=1
        fi
    done

    if sudo systemctl enable --now iwd.service; then
        ok "iwd.service enabled and started"
    else
        warn "iwd.service could not be enabled."
    fi
    if sudo systemctl enable --now bluetooth.service; then
        ok "bluetooth.service enabled and started"
    else
        warn "bluetooth.service could not be enabled."
    fi

    return "$failed"
}

# end
print_done() {


    info "         Installation complete!              "

    echo -e "\n${BOLD}Next steps:${N}"
    echo -e "  1. ${Y}Reboot${N} (recommended) or re-login"
    echo -e "  2. Start Hyprland from your display manager or TTY"
    echo -e "  3. AGS starts automatically from the Hyprland Lua config"
    echo -e "     (if not: ${C}$CFG/ags/scripts/launch-ags.sh${N})"
    echo -e "  4. Add wallpapers to ${C}$FN_APPS_DIR/fnwall/wallpapers/${N}"
    echo -e "     then select one from the AGS dashboard \n"

    echo -e "  Chroma: ${C}$HOME/.local/bin/chroma${N}"
    echo -e "  Starship: ${C}/usr/bin/starship${N}"
    echo -e "  fnsession: ${C}$HOME/.local/bin/fnsession${N}"
    echo -e "  fnnetspeed: ${C}$HOME/.local/bin/fnnetspeed${N}"
    echo -e "  Keyboard: ${C}$KEYBOARD_LAYOUT${N}"
    echo -e "  Lyrics: ${C}$HOME/lyrics${N}"
    if [[ -d "$BACKUP_ROOT" ]]; then
        echo -e "  Previous configs: ${C}$BACKUP_ROOT${N}"
    elif [[ $NO_BACKUP -eq 1 ]]; then
        echo -e "  Previous configs: ${Y}not retained (--no-backup)${N}"
    fi

    echo ""
}

# Main install function
main() {
    local parse_status=0
    parse_install_args "$@" || parse_status=$?
    [[ $parse_status -eq 10 ]] && return 0
    [[ $parse_status -eq 0 ]] || return "$parse_status"
    check_arch_host
    if [[ -t 1 && ${TERM:-dumb} != dumb ]]; then
        clear
    fi
    echo -e "${BOLD}${C}"
    echo -e "                   ${Y}Hyprland + AGS v3 setup${C}"
    echo -e "               by finixtavh | github.com/finixtavh/fndots"
    echo -e "${N}"
    if [[ $NO_BACKUP -eq 1 ]]; then
        echo -e "  ${Y}WARNING:${N} --no-backup"
    else
        echo -e "  ${Y}WARNING:${N} Existing configs are preserved under"
        echo -e "           ${C}${STATE_HOME}/fndots/backups/${N}"
    fi
    echo ""
    read -rp "  Press Enter to continue, or Ctrl+C to cancel... "

    secure_deploy_state
    upgrade_arch_system
    install_yay
    clone_dotfiles
    validate_dotfiles_source
    install_deps
    install_oh_my_zsh
    validate_runtime_versions
    validate_keyboard_layout
    require_network_stack || return 1
    verify_icon_stack
    install_chroma
    install_battery_limit_helper
    begin_deploy_transaction
    install_fn_apps || { rollback_deploy_transaction; return 1; }
    install_configs || { rollback_deploy_transaction; return 1; }
    install_user_assets || { rollback_deploy_transaction; return 1; }
    commit_deploy_transaction
    configure_appimage_mime || warn "AppImage MIME associations could not be configured."
    configure_logind || warn "The power-key integration could not be configured."
    enable_services || warn "PipeWire user services could not be enabled in this session."
    print_done
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
    main "$@"
fi
