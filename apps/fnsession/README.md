# fnsession

`fnsession` is a small Hyprland 0.56 session CLI. It saves each mapped
window's workspace, absolute position, size, identity, and a minimal launch
command in a JSON file.

```text
fnsession save [name]
fnsession load [name]
fnsession watch [name] [--interval seconds]
```