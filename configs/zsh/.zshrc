export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
export MEDIAISPLAYING=true
export JAVA_HOME=/usr/lib/jvm/java-25-openjdk
export PATH="$JAVA_HOME/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.opencode/bin:$PATH"

typeset -g FN_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
typeset -g FN_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
[[ "$FN_CONFIG_HOME" == /* ]] || FN_CONFIG_HOME="$HOME/.config"
[[ "$FN_CACHE_HOME" == /* ]] || FN_CACHE_HOME="$HOME/.cache"

typeset -g FN_TERM_STARSHIP=true FN_TERM_PYENV=true
typeset -g FN_TERM_COMPLETIONS=true FN_TERM_PLUGINS=true
typeset -g _fn_term_line=''
if [[ -r "$FN_CONFIG_HOME/ags/user-settings.json" ]] && (( $+commands[jq] )); then
    _fn_term_line=$(jq -r '[
      (.terminalStarship // true),
      (.terminalPyenv // true), (.terminalCompletions // true),
      (.terminalPlugins // true)
    ] | @tsv' "$FN_CONFIG_HOME/ags/user-settings.json" 2>/dev/null) || _fn_term_line=''
    if [[ -n "$_fn_term_line" ]]; then
        IFS=$'\t' read -r FN_TERM_STARSHIP FN_TERM_PYENV FN_TERM_COMPLETIONS FN_TERM_PLUGINS <<< "$_fn_term_line"
    fi
fi
unset _fn_term_line

[[ "$FN_TERM_STARSHIP" == true ]] && command -v starship >/dev/null 2>&1 && eval "$(starship init zsh)"
if [[ "$FN_TERM_PYENV" == true ]] && command -v pyenv >/dev/null 2>&1; then
    eval "$(pyenv init -)"
    eval "$(pyenv virtualenv-init -)"
fi

if [[ "$FN_TERM_PLUGINS" == true ]]; then
    for plugin in \
        /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh \
        /usr/share/zsh/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh \
        /usr/share/zsh/plugins/zsh-sudo/sudo.plugin.zsh \
        /usr/share/zsh/plugins/zsh-auto-notify/auto-notify.plugin.zsh; do
        [[ -r "$plugin" ]] && source "$plugin"
    done
    unset plugin
fi

setopt AUTO_CD
setopt INC_APPEND_HISTORY
setopt SHARE_HISTORY
setopt HIST_REDUCE_BLANKS
setopt HIST_VERIFY
setopt HIST_FIND_NO_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_SAVE_NO_DUPS

ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#696969,bold"
HISTSIZE=2000
SAVEHIST=2000
HISTDIR="$FN_CACHE_HOME/zsh"
HISTFILE=$HISTDIR/history
mkdir -p "$HISTDIR"
chmod 700 "$HISTDIR"
[[ -f "$HISTFILE" ]] || touch "$HISTFILE"
chmod 600 "$HISTFILE"

if [[ "$FN_TERM_COMPLETIONS" == true ]]; then
    autoload -Uz compinit
    typeset -g FN_ZCOMPDUMP="$HISTDIR/zcompdump"
    if [[ -s "$FN_ZCOMPDUMP" && "$FN_ZCOMPDUMP" -nt /usr/share/zsh ]]; then
        compinit -C -d "$FN_ZCOMPDUMP"
    else
        compinit -d "$FN_ZCOMPDUMP"
    fi
fi

zstyle ':completion:*' menu select
zstyle ':completion:*' group-name ''
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}

if [[ "$FN_TERM_PLUGINS" == true ]]; then
    bindkey '^[[A' history-substring-search-up
    bindkey '^[[B' history-substring-search-down
fi

# fnctl 
fpath=("$FN_CONFIG_HOME/zsh/functions" $fpath)
autoload -Uz fnctl

alias ls='lsd'
alias cat='bat'

quickspeed() {
    if (( $+commands[quickspeed] )); then
        command quickspeed "$@"
    else
        print -u2 -- 'quickspeed is not installed locally; refusing to execute mutable remote code.'
        print -u2 -- 'Install a reviewed copy as ~/.local/bin/quickspeed, then run it again.'
        return 127
    fi
}
alias logout='hyprctl dispatch exit'

if [[ "$FN_TERM_PLUGINS" == true ]]; then
    [[ -r /usr/share/fzf/key-bindings.zsh ]] && source /usr/share/fzf/key-bindings.zsh
    [[ -r /usr/share/fzf/completion.zsh ]] && source /usr/share/fzf/completion.zsh

    # zsh-syntax-highlighting must be sourced after widgets and bindings.
    [[ -r /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]] \
        && source /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi
