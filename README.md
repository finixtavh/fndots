# FNDots

Opinionated Dotfiles made in **Arch Linux** for **Hyprland 0.56** with **AGS v3**.

<div align="center">

| <img width="640" height="360" alt="image" src="https://github.com/user-attachments/assets/e67022b8-03d7-4a28-b58a-38ff5dfa4e64" /> | <img width="640" height="360" alt="image" src="https://github.com/user-attachments/assets/48a804e8-f25a-458a-877e-1e10264343b6" /> |
|:---:|:---:|
| Wallpaper Source: <a href="https://kriegs.net/">kriegs.net</a> | Wallpaper Source: <a href="https://www.youtube.com/watch?v=eNnL750ViLY">Arcavh</a> |

</div>

## Installation

```bash
bash install.sh
```

```bash
--no-backups // doesn't make any backup folder at .local/
```

Backups are stored in:

```text
$HOME/.local/state/dotfiles-v2/backups/
```

## Update

```bash
bash update.sh --all
```

```bash
-.all        // forces update on all files, even if the repo folder is up-to date
--no-backups // doesn't make any backup folder at .local/
```

## Repo Structure

* `configs/`  AGS, Hyprland, Cava, Fastfetch, Rofi, Starship, Thunar, Wallman, XDG, and Zsh configs.
* `apps/`  Standalone apps like as `fnsession` and `fnnetspeed`.
* `assets/`  Fonts, Cava shaders, and wallpapers.

### TODO

* Rework m-left-pill and m-right-pill (those 2 pill at the top-left and right corner)
* Fix triangles having a sharp edge that appears sometimes?
* CPU and RAM widgets passing infront of the MainBar when fading out/in
* Maybe making text a bit bigger

i dont think someone gonna look at these dotfiles, feel free to PR tho.
