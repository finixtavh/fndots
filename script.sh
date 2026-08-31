#!/usr/bin/env bash
# Dotfiles sync

set -euo pipefail
umask 077

[[ ${HOME:-} == /* ]] || {
    printf 'script.sh: HOME must be an absolute path.\n' >&2
    exit 1
}

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
[[ "$CONFIG_HOME" == /* ]] || CONFIG_HOME="$HOME/.config"
FN_APPS_DIR="$HOME/fn-apps"

REPO_URL="https://github.com/finixtavh/fndots.git"

is_fndots_origin() {
    case "$1" in
        "$REPO_URL"|"${REPO_URL%.git}"|"git@github.com:finixtavh/fndots.git"|"ssh://git@github.com/finixtavh/fndots.git")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

[[ -d "$REPO_DIR/.git" ]] || {
    printf 'script.sh: %s is not a Git checkout.\n' "$REPO_DIR" >&2
    exit 1
}
origin="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
is_fndots_origin "$origin" || {
    printf 'script.sh: %s is not a clone of %s.\n' "$REPO_DIR" "$REPO_URL" >&2
    printf 'Refusing to sync live configs into an unexpected repository.\n' >&2
    exit 1
}

copy_tree() {
    local source="$1" destination="$2" file relative
    [[ -d "$source" ]] || {
        printf 'Missing source: %s\n' "$source" >&2
        return 1
    }
    mkdir -p -- "$destination"
    while IFS= read -r -d '' file; do
        relative="${file#"$source"/}"
        case "$relative" in
            @girs/*|node_modules/*|.ruff_cache/*|__pycache__/*|*/__pycache__/*|package-lock.json|user-settings.json|*.pyc|*.pyo|*.bak|*.bak2|wallpapers/*|terminal_wallpapers/*)
                continue
                ;;
        esac
        if [[ "$source" == "$CONFIG_HOME/cava" && "$relative" == shaders/* ]]; then
            continue
        fi
        mkdir -p -- "$destination/$(dirname -- "$relative")"
        cp -a -- "$file" "$destination/$relative"
    done < <(
        find "$source" \
            -type d \( -name @girs -o -name node_modules -o -name .ruff_cache -o -name __pycache__ \) -prune -o \
            \( -type f -o -type l \) -print0
    )
}

copy_file() {
    local source="$1" destination="$2"
    [[ -f "$source" ]] || {
        printf 'Missing source: %s\n' "$source" >&2
        return 1
    }
    mkdir -p -- "$(dirname -- "$destination")"
    cp -a -- "$source" "$destination"
}

for config in ags hypr rofi cava fastfetch zsh; do
    copy_tree "$CONFIG_HOME/$config" "$REPO_DIR/configs/$config"
done

copy_tree "$CONFIG_HOME/Thunar" "$REPO_DIR/configs/thunar"
copy_file "$CONFIG_HOME/starship.toml" "$REPO_DIR/configs/starship/starship.toml"
copy_file "$CONFIG_HOME/mimeapps.list" "$REPO_DIR/configs/xdg/mimeapps.list"
copy_file "$HOME/.zshrc" "$REPO_DIR/configs/zsh/.zshrc"

for app in fnsession fnnetspeed fnwall; do
    copy_tree "$FN_APPS_DIR/$app" "$REPO_DIR/apps/$app"
done

printf 'Dotfiles synchronized to %s\n' "$REPO_DIR"
git -C "$REPO_DIR" status --short
