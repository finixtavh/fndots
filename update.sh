#!/usr/bin/env bash
# updater
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

usage() {
    cat <<'EOF'
Usage: update.sh [--all] [--no-backup] [--net-backend=MODE]

Pull the dotfiles repository and deploy only the managed directories changed by
the new commits. By default, existing files are preserved below XDG_STATE_HOME ( aka ~/ ).

Options:
  --all     Deploy every managed config and FN application, even with no new commit/s in the Github repo.
  --no-backup
            Do not retain previous dotfiles below XDG_STATE_HOME.
  --net-backend=MODE
            Switch the Wi-Fi stack now: nm-iwd (NetworkManager with iwd
            backend) or iwd-only (NetworkManager disabled). You will be
            asked to confirm before services are changed.
  -h, --help
            Show this.
EOF
}

UPDATE_ALL=0
UPDATE_NO_BACKUP=0
UPDATE_NET_BACKEND=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)
            UPDATE_ALL=1
            ;;
        --no-backup)
            UPDATE_NO_BACKUP=1
            ;;
        --net-backend=*)
            UPDATE_NET_BACKEND="${1#*=}"
            case "$UPDATE_NET_BACKEND" in
                nm-iwd|iwd-only) ;;
                *)
                    printf 'update.sh: invalid network backend: %s (expected nm-iwd or iwd-only)\n' "$UPDATE_NET_BACKEND" >&2
                    exit 2
                    ;;
            esac
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            printf 'update.sh: unknown option: %s\n\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

UPDATE_ARGS=()
rebuild_update_args() {
    UPDATE_ARGS=()
    [[ $UPDATE_ALL -eq 0 ]] || UPDATE_ARGS+=(--all)
    [[ $UPDATE_NO_BACKUP -eq 0 ]] || UPDATE_ARGS+=(--no-backup)
    [[ -z "${UPDATE_NET_BACKEND:-}" ]] || UPDATE_ARGS+=(--net-backend="$UPDATE_NET_BACKEND")
}
rebuild_update_args
UPDATE_REEXECUTED="${FNDOTS_UPDATE_REEXECUTED:-0}"
[[ "$UPDATE_REEXECUTED" == "0" || "$UPDATE_REEXECUTED" == "1" ]] || {
    printf 'update.sh: invalid internal restart state.\n' >&2
    exit 2
}
[[ ${HOME:-} == /* ]] || {
    printf 'update.sh: HOME must be set to an absolute path.\n' >&2
    exit 1
}
UPDATE_SCRIPT_PATH="$(realpath -m -- "${BASH_SOURCE[0]:-$0}")"
UPDATE_SCRIPT_DIR="$(dirname -- "$UPDATE_SCRIPT_PATH")"
DEFAULT_CLONE="$HOME/.fndots"

REPO_ROOT="$(git -C "$UPDATE_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" || ! -f "$REPO_ROOT/install.sh" || ! -f "$REPO_ROOT/update.sh" ]]; then
    if [[ -d "$DEFAULT_CLONE/.git" ]]; then
        REPO_ROOT="$DEFAULT_CLONE"
    else
        printf 'update.sh: could not locate the dotfiles Git checkout.\n' >&2
        printf 'Run this script from the checkout or run install.sh first.\n' >&2
        exit 1
    fi
fi

source "$REPO_ROOT/install.sh"

NO_BACKUP=$UPDATE_NO_BACKUP

DOTFILES="$REPO_ROOT"
SCRIPT_DIR="$REPO_ROOT"
CFG="$(xdg_dir_or_default "${XDG_CONFIG_HOME:-}" "$HOME/.config")"
FN_APPS_DIR="$HOME/fn-apps"
STATE_HOME="$(xdg_dir_or_default "${XDG_STATE_HOME:-}" "$HOME/.local/state")"
BACKUP_ROOT="$STATE_HOME/fndots/backups/$(date +%Y%m%d-%H%M%S)-$$"
PENDING_FILE="$STATE_HOME/fndots/update-pending"

BEFORE=""
AFTER=""
CHANGED_FILES=()
INSTALLER_CHANGED=0
AGS_UPDATED=0
SHELL_UPDATED=0
MIME_UPDATE_NEEDED=0
NO_UPDATE=0
PENDING_TARGET=""

path_changed() {
    local root="$1" path
    [[ $UPDATE_ALL -eq 0 ]] || return 0
    for path in "${CHANGED_FILES[@]}"; do
        if [[ "$path" == "$root" || "$path" == "$root/"* ]]; then
            return 0
        fi
    done
    return 1
}

config_changed() {
    path_changed "configs/$1"
}

asset_changed() {
    path_changed "assets/$1"
}

config_requires_deploy() {
    local rel="$1"
    config_changed "$rel" && return 0
    case "$rel" in
        hypr) asset_changed chroma ;;
        *) return 1 ;;
    esac
}

ensure_clean_checkout() {
    local dirty
    if ! dirty="$(git -C "$DOTFILES" status --porcelain --untracked-files=normal)"; then
        err "Could not inspect the dotfiles checkout."
        return 1
    fi
    if [[ -n "$dirty" ]]; then
        err "The dotfiles checkout has uncommitted or untracked files."
        err "Commit, stash, or remove them before updating; full directory trees are deployed."
        printf '%s\n' "$dirty" >&2
        return 1
    fi
}

write_pending_update() {
    local pending_dir staged
    pending_dir="$(dirname -- "$PENDING_FILE")"
    mkdir -p -- "$pending_dir" || {
        err "Could not create updater state directory: $pending_dir"
        return 1
    }
    if ! staged="$(mktemp "$pending_dir/.update-pending.XXXXXX")"; then
        err "Could not create pending-update state."
        return 1
    fi
    if ! printf '%s\n%s\n%s\n%s\n%s\n' \
        "$DOTFILES" "$BEFORE" "$AFTER" "$UPDATE_ALL" "$UPDATE_NO_BACKUP" > "$staged"; then
        rm -f -- "$staged" || true
        err "Could not record pending-update state."
        return 1
    fi
    chmod 600 -- "$staged" || {
        rm -f -- "$staged" || true
        err "Could not protect pending-update state."
        return 1
    }
    if ! mv -- "$staged" "$PENDING_FILE"; then
        rm -f -- "$staged" || true
        err "Could not activate pending-update state."
        return 1
    fi
}

read_pending_update() {
    local lines=()
    if ! mapfile -t lines < "$PENDING_FILE"; then
        err "Could not read pending update: $PENDING_FILE"
        return 1
    fi
    if [[ ${#lines[@]} -lt 2 || "${lines[0]}" != "$DOTFILES" ]]; then
        err "Pending-update state does not belong to this checkout: $PENDING_FILE"
        return 1
    fi

    BEFORE="${lines[1]}"
    PENDING_TARGET="${lines[2]:-}"
    case "${lines[3]:-0}" in
        0)
            ;;
        1)
            UPDATE_ALL=1
            ;;
        *)
            err "Pending-update state has an invalid deployment mode."
            return 1
            ;;
    esac
    case "${lines[4]:-0}" in
        0)
            ;;
        1)
            UPDATE_NO_BACKUP=1
            NO_BACKUP=1
            ;;
        *)
            err "Pending-update state has an invalid backup mode."
            return 1
            ;;
    esac
    rebuild_update_args
    git -C "$DOTFILES" cat-file -e "$BEFORE^{commit}" 2>/dev/null || {
        err "Pending update references an unavailable commit: $BEFORE"
        return 1
    }
    if ! AFTER="$(git -C "$DOTFILES" rev-parse HEAD)"; then
        err "Could not read the current dotfiles revision."
        return 1
    fi
    if [[ -n "$PENDING_TARGET" ]] &&
       ! git -C "$DOTFILES" cat-file -e "$PENDING_TARGET^{commit}" 2>/dev/null; then
        err "Pending update references an unavailable target: $PENDING_TARGET"
        return 1
    fi
    if ! git -C "$DOTFILES" merge-base --is-ancestor "$BEFORE" "$AFTER"; then
        err "The checkout moved behind or away from pending base $BEFORE."
        err "Resolve the repository state manually, then remove $PENDING_FILE."
        return 1
    fi
    if [[ -n "$PENDING_TARGET" ]] &&
       ! git -C "$DOTFILES" merge-base --is-ancestor "$PENDING_TARGET" "$AFTER"; then
        err "The checkout moved behind or away from pending target $PENDING_TARGET."
        err "Resolve the repository state manually, then remove $PENDING_FILE."
        return 1
    fi
}

load_changed_files() {
    local changed_output changed
    if ! changed_output="$(git -C "$DOTFILES" diff --name-only "$BEFORE" "$AFTER")"; then
        err "Could not determine files changed by the update."
        return 1
    fi

    CHANGED_FILES=()
    if [[ -n "$changed_output" ]]; then
        mapfile -t CHANGED_FILES <<< "$changed_output"
    fi
    INSTALLER_CHANGED=0
    for changed in "${CHANGED_FILES[@]}"; do
        if [[ "$changed" == "install.sh" || "$changed" == "scripts/install.sh" ]]; then
            INSTALLER_CHANGED=1
        fi
    done
}

pull_changes() {
    header "Update repository"
    ensure_clean_checkout || return 1

    if [[ -f "$PENDING_FILE" ]]; then
        read_pending_update || return 1
        if [[ -n "$PENDING_TARGET" || "$BEFORE" != "$AFTER" ]]; then
            warn "Resuming an incomplete update from ${BEFORE:0:12}."
            load_changed_files || return 1
            return 0
        fi
        info "Retrying the previously interrupted git pull."
        clear_pending_update || return 1
    fi

    if ! BEFORE="$(git -C "$DOTFILES" rev-parse HEAD)"; then
        err "Could not read the current dotfiles revision."
        return 1
    fi
    AFTER=""
    write_pending_update || return 1
    if ! git -C "$DOTFILES" pull --ff-only; then
        err "git pull --ff-only failed; no files were deployed. A retry marker was kept."
        return 1
    fi
    if ! AFTER="$(git -C "$DOTFILES" rev-parse HEAD)"; then
        err "Could not read the updated dotfiles revision."
        return 1
    fi

    if [[ "$BEFORE" == "$AFTER" && $UPDATE_ALL -eq 0 ]]; then
        clear_pending_update || return 1
        ok "Repository is already up to date"
        NO_UPDATE=1
        return 0
    elif [[ "$BEFORE" == "$AFTER" ]]; then
        write_pending_update || return 1
        info "Repository is current; --all will redeploy managed files."
    else
        write_pending_update || return 1
        load_changed_files || return 1
        info "Downloaded commits:"
        git -C "$DOTFILES" log --oneline "$BEFORE..$AFTER" || {
            err "Could not display downloaded commits."
            return 1
        }
        local changed
        if [[ "$UPDATE_REEXECUTED" == "0" ]]; then
            for changed in "${CHANGED_FILES[@]}"; do
                case "$changed" in install.sh | update.sh | scripts/install.sh | scripts/update.sh)
                    info "Updater changed; continuing with the new version..."
                    exec env FNDOTS_UPDATE_REEXECUTED=1 bash "$DOTFILES/update.sh" "${UPDATE_ARGS[@]}"
                    err "Could not restart the updated updater."
                    return 1
                    ;;
                esac
            done
        fi
    fi
    [[ "$BEFORE" == "$AFTER" ]] || return 0
    CHANGED_FILES=()
    INSTALLER_CHANGED=0
}

validate_update_sources() {
    local rel missing=0
    local required_dirs=(
        configs/ags configs/hypr configs/rofi
        configs/zsh configs/starship configs/xdg configs/thunar
        assets/lyrics assets/chroma assets/wallpapers/desktop assets/wallpapers/terminal
        apps/fnsession apps/fnnetspeed apps/fnwall
    )

    for rel in "${required_dirs[@]}"; do
        path_changed "$rel" || continue
        if [[ ! -d "$DOTFILES/$rel" ]]; then
            err "Required directory is missing from the checkout: $rel/"
            missing=1
        fi
    done
    if config_changed ags; then
        for rel in configs/ags/app.ts configs/ags/style.scss configs/ags/user-settings.json configs/ags/widget/Helpers/Paths.ts; do
            if [[ ! -f "$DOTFILES/$rel" ]]; then
                err "Required file is missing from the checkout: $rel"
                missing=1
            fi
        done
    fi
    if config_changed hypr; then
        for rel in \
            configs/hypr/hyprland.lua configs/hypr/paths.lua configs/hypr/user_settings.lua \
            configs/hypr/keyboard.lua configs/hypr/animations.lua configs/hypr/rules.lua \
            configs/hypr/keybinds.lua; do
            if [[ ! -f "$DOTFILES/$rel" ]]; then
                err "Required file is missing from the checkout: $rel"
                missing=1
            fi
        done
    fi
    if config_changed zsh && [[ ! -f "$DOTFILES/configs/zsh/.zshrc" ]]; then
        err "Required file is missing from the checkout: configs/zsh/.zshrc"
        missing=1
    fi
    if config_changed starship && [[ ! -f "$DOTFILES/configs/starship/starship.toml" ]]; then
        err "Required file is missing from the checkout: configs/starship/starship.toml"
        missing=1
    fi
    if config_changed zsh && [[ ! -f "$DOTFILES/configs/zsh/functions/fnctl" ]]; then
        err "Required file is missing from the checkout: configs/zsh/functions/fnctl"
        missing=1
    fi
    if config_changed xdg && [[ ! -f "$DOTFILES/configs/xdg/mimeapps.list" ]]; then
        err "Required file is missing from the checkout: configs/xdg/mimeapps.list"
        missing=1
    fi
    if config_changed thunar; then
        for rel in configs/thunar/appimage-run.desktop configs/thunar/scripts/appimage-run configs/thunar/scripts/extract-here; do
            if [[ ! -f "$DOTFILES/$rel" ]]; then
                err "Required file is missing from the checkout: $rel"
                missing=1
            fi
        done
    fi
    if asset_changed chroma; then
        for rel in assets/chroma/fn-dots.toml assets/chroma/fn-dots.wgsl assets/chroma/presets; do
            if [[ ! -e "$DOTFILES/$rel" ]]; then
                err "Required path is missing from the checkout: $rel"
                missing=1
            fi
        done
    fi
    if path_changed apps; then
        for rel in \
            apps/fnsession/fnsession apps/fnsession/README.md \
            apps/fnnetspeed/fnnetspeed apps/fnwall/wallpicker.sh apps/fnwall/restore.sh; do
            if [[ ! -f "$DOTFILES/$rel" ]]; then
                err "Required file is missing from the checkout: $rel"
                missing=1
            fi
        done
    fi


    [[ $missing -eq 0 ]] || {
        err "The update is incomplete; missing sources were not deployed."
        return 1
    }

    if config_changed zsh; then
        validate_zsh_sources || return 1
    fi
    if config_changed starship; then
        validate_starship_config "$DOTFILES/configs/starship/starship.toml" || return 1
    fi
}

sync_configs() {
    header "Deploy changed files"
    local rel dst updated=0
    local required_dirs=(ags hypr rofi zsh thunar)
    local optional_dirs=(kitty dunst gtk-3.0 gtk-4.0 Kvantum)
    
    if path_changed configs/ags/scripts/battery-limit.sh; then
        install_battery_limit_helper || return 1
    fi

    for rel in "${required_dirs[@]}"; do
        config_requires_deploy "$rel" || continue
        dst="$CFG/$rel"
        [[ "$rel" != "thunar" ]] || dst="$CFG/Thunar"
        deploy_config_tree "$rel" "$DOTFILES/configs/$rel" "$dst" || return 1
        [[ "$rel" != "ags" ]] || AGS_UPDATED=1
        [[ "$rel" != "zsh" ]] || SHELL_UPDATED=1
        updated=1
    done

    for rel in "${optional_dirs[@]}"; do
        config_changed "$rel" || continue
        if [[ -d "$DOTFILES/configs/$rel" ]]; then
            deploy_config_tree "$rel" "$DOTFILES/configs/$rel" "$CFG/$rel" || return 1
            updated=1
        elif [[ $UPDATE_ALL -eq 1 ]]; then
            info "Optional config not present: $rel/"
        else
            warn "$rel/ was removed from the repository; the live config was left untouched."
        fi
    done

    if path_changed apps/fnsession; then
        deploy_fnsession || return 1
        updated=1
    fi
    if path_changed apps/fnnetspeed; then
        deploy_fnnetspeed || return 1
        updated=1
    fi
    if path_changed apps/fnwall || asset_changed wallpapers; then
        deploy_fnwall || return 1
        updated=1
    fi
    if config_changed zsh; then
        deploy_file "$DOTFILES/configs/zsh/.zshrc" "$HOME/.zshrc" 644 || return 1
        SHELL_UPDATED=1
        updated=1
    fi
    if config_changed starship; then
        deploy_file "$DOTFILES/configs/starship/starship.toml" "$CFG/starship.toml" 644 || return 1
        SHELL_UPDATED=1
        updated=1
    fi
    if config_changed thunar; then
        deploy_thunar_integration || return 1
        MIME_UPDATE_NEEDED=1
        updated=1
    fi
    if config_changed xdg; then
        MIME_UPDATE_NEEDED=1
    fi
    if asset_changed lyrics; then
        deploy_overlay_tree "$DOTFILES/assets/lyrics" "$HOME/lyrics" || return 1
        updated=1
    fi

    if [[ $updated -eq 0 ]]; then
        warn "No managed config or app directory changed."
    fi
}

clear_pending_update() {
    [[ -f "$PENDING_FILE" ]] || return 0
    if ! rm -f -- "$PENDING_FILE"; then
        err "Could not clear updater state: $PENDING_FILE"
        return 1
    fi
}

print_update_done() {
    echo ""
    echo -e "${BOLD}${G}Dotfiles update complete.${N}"
    echo -e "  Commit: ${C}$(git -C "$DOTFILES" rev-parse --short HEAD)${N} | $(git -C "$DOTFILES" log -1 --format='%s')"
    if [[ -d "$BACKUP_ROOT" ]]; then
        echo -e "  Previous files: ${C}$BACKUP_ROOT${N}"
    elif [[ $NO_BACKUP -eq 1 ]]; then
        echo -e "  Previous files: ${Y}not retained (--no-backup)${N}"
    fi
    if [[ $INSTALLER_CHANGED -eq 1 ]]; then
        echo -e "  ${Y}install.sh changed; rerun it if the update added system dependencies.${N}"
    fi
    echo -e "  No .bak or .bak2 files were created."
    if [[ $AGS_UPDATED -eq 1 ]]; then
        echo ""
        echo -e "  ${Y}Restart AGS to load AGS changes:${N}"
        echo -e "  ${C}ags quit -i ags-bar; sleep 0.3; nohup $CFG/ags/scripts/launch-ags.sh >/dev/null 2>&1 &${N}"
        echo ""
    fi
    if [[ $SHELL_UPDATED -eq 1 ]]; then
        echo -e "  ${Y}Open a new Zsh session to load shell changes.${N}"
    fi
}

main() {
    [[ $EUID -ne 0 ]] || { err "Run as your normal user, not root."; return 1; }
    command -v git &>/dev/null || { err "git not found."; return 1; }
    secure_deploy_state
    pull_changes
    if [[ $NO_UPDATE -eq 1 ]]; then
        return 0
    fi

    validate_update_sources
    begin_deploy_transaction
    sync_configs || { rollback_deploy_transaction; return 1; }
    commit_deploy_transaction
    if [[ $MIME_UPDATE_NEEDED -eq 1 ]]; then
        configure_appimage_mime || warn "AppImage MIME associations could not be refreshed."
    fi
    clear_pending_update
    if [[ -n "${UPDATE_NET_BACKEND:-}" ]]; then
        NET_BACKEND="$UPDATE_NET_BACKEND" configure_network_backend || warn "Network backend could not be switched."
    fi
    print_update_done
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
    main "$@"
fi
