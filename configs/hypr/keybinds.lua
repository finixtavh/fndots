-- keybinds, change as you like
local mainMod = "SUPER"
local paths = require("paths")

local function restricted_bind(keys, dispatcher, options)
    hl.bind(keys, function()
        local active = hl.get_active_window()
        if active and (active.fullscreen or 0) ~= 0 then
            return
        end
        hl.dispatch(dispatcher)
    end, options)
end

restricted_bind(mainMod .. " + Return", hl.dsp.exec_cmd("kitty"))
restricted_bind(mainMod .. " + T", hl.dsp.exec_cmd("kitty"))
restricted_bind("CTRL+ALT + T", hl.dsp.exec_cmd("kitty"))
restricted_bind(mainMod .. " + E", hl.dsp.exec_cmd("thunar"))
restricted_bind(mainMod .. " + W", hl.dsp.exec_cmd("firefox"))
restricted_bind(mainMod .. " + C", hl.dsp.exec_cmd("ags toggle -i ags-bar notif-center"))
restricted_bind(mainMod .. "+SHIFT + D", hl.dsp.exec_cmd("ags toggle -i ags-bar dashboard"))
restricted_bind(mainMod .. " + X", hl.dsp.exec_cmd("kate"))
restricted_bind(mainMod .. " + I", hl.dsp.exec_cmd("ags toggle -i ags-bar cava-settings"))
restricted_bind("CTRL+SHIFT + Escape", hl.dsp.exec_cmd("gnome-system-monitor"))

hl.bind(
    "SUPER + SUPER_L",
    hl.dsp.exec_cmd("ags request -i ags-bar toggle-app-launcher"),
    { release = true }
)

hl.bind("Super_L", hl.dsp.exec_cmd("ags request -i ags-bar toggle-app-launcher"), { release = true })
hl.bind(
    "Escape",
    hl.dsp.exec_cmd("ags request -i ags-bar dismiss-escape-flyouts >/dev/null 2>&1"),
    { non_consuming = true, transparent = true }
)
hl.bind(
    "Caps_Lock",
    hl.dsp.exec_cmd("ags request -i ags-bar osd-caps"),
    { non_consuming = true, transparent = true }
)
restricted_bind(mainMod .. "+SHIFT+ALT + W", hl.dsp.exec_cmd(paths.shell_quote(paths.home_path("fn-apps/fnwall/wallpicker.sh")) .. " --random"))
restricted_bind(mainMod .. " + Period", hl.dsp.exec_cmd("ags request -i ags-bar show-dashboard-emoji"))
restricted_bind(mainMod .. " + N", hl.dsp.exec_cmd("ags toggle -i ags-bar notif-center"))

hl.bind(mainMod .. " + Q", hl.dsp.window.close())
hl.bind("ALT + F4", hl.dsp.window.close())
restricted_bind(mainMod .. "+SHIFT+ALT + Q", hl.dsp.exec_cmd("hyprctl kill"))

restricted_bind(mainMod .. " + Left", hl.dsp.focus({ direction = "left" }))
restricted_bind(mainMod .. " + Right", hl.dsp.focus({ direction = "right" }))
restricted_bind(mainMod .. " + Up", hl.dsp.focus({ direction = "up" }))
restricted_bind(mainMod .. " + Down", hl.dsp.focus({ direction = "down" }))
restricted_bind(mainMod .. " + BracketLeft", hl.dsp.focus({ direction = "left" }))
restricted_bind(mainMod .. " + BracketRight", hl.dsp.focus({ direction = "right" }))
restricted_bind(mainMod .. " + Tab", hl.dsp.window.cycle_next())

restricted_bind(mainMod .. "+SHIFT + Left", hl.dsp.window.move({ direction = "left" }))
restricted_bind(mainMod .. "+SHIFT + Right", hl.dsp.window.move({ direction = "right" }))
restricted_bind(mainMod .. "+SHIFT + Up", hl.dsp.window.move({ direction = "up" }))
restricted_bind(mainMod .. "+SHIFT + Down", hl.dsp.window.move({ direction = "down" }))

restricted_bind(mainMod .. "+ALT + Space", hl.dsp.window.float({ action = "toggle" }))
restricted_bind(mainMod .. " + D", hl.dsp.window.fullscreen({ mode = "maximized", action = "toggle" }))
hl.bind(mainMod .. " + F", hl.dsp.window.fullscreen({ mode = "fullscreen", action = "toggle" }))
restricted_bind(mainMod .. " + P", hl.dsp.window.pin())

restricted_bind(mainMod .. " + Semicolon", hl.dsp.layout("splitratio -0.1"), { repeating = true })
restricted_bind(mainMod .. " + Apostrophe", hl.dsp.exec_cmd("ags toggle -i ags-bar keybinds-viewer"))

restricted_bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })
restricted_bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true })

for i = 1, 9 do
    restricted_bind(mainMod .. " + " .. tostring(i), hl.dsp.focus({ workspace = tostring(i) }))
    restricted_bind(mainMod .. "+ALT + " .. tostring(i), hl.dsp.window.move({ workspace = tostring(i), follow = false }))
    restricted_bind(mainMod .. "+SHIFT + " .. tostring(i), hl.dsp.window.move({ workspace = tostring(i) }))
end

restricted_bind(mainMod .. " + 0", hl.dsp.focus({ workspace = "10" }))
restricted_bind(mainMod .. "+ALT + 0", hl.dsp.window.move({ workspace = "10", follow = false }))
restricted_bind(mainMod .. "+SHIFT + 0", hl.dsp.window.move({ workspace = "10" }))

hl.bind("CTRL+" .. mainMod .. " + Right", hl.dsp.focus({ workspace = "r+1" }))
hl.bind("CTRL+" .. mainMod .. " + Left", hl.dsp.focus({ workspace = "r-1" }))
hl.bind("mouse:275", hl.dsp.focus({ workspace = "r-1" }))
hl.bind("mouse:276", hl.dsp.focus({ workspace = "r+1" }))
restricted_bind(mainMod .. " + Page_Down", hl.dsp.focus({ workspace = "+1" }))
restricted_bind(mainMod .. " + Page_Up", hl.dsp.focus({ workspace = "-1" }))

restricted_bind(mainMod .. " + mouse_up", hl.dsp.focus({ workspace = "+1" }))
restricted_bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "-1" }))

restricted_bind(mainMod .. "+SHIFT + mouse_down", hl.dsp.window.move({ workspace = "r-1" }))
restricted_bind(mainMod .. "+SHIFT + mouse_up", hl.dsp.window.move({ workspace = "r+1" }))
restricted_bind(mainMod .. "+SHIFT + Page_Down", hl.dsp.window.move({ workspace = "r+1" }))
restricted_bind(mainMod .. "+SHIFT + Page_Up", hl.dsp.window.move({ workspace = "r-1" }))
hl.bind("CTRL+" .. mainMod .. "+SHIFT + Right", hl.dsp.window.move({ workspace = "r+1" }))
hl.bind("CTRL+" .. mainMod .. "+SHIFT + Left", hl.dsp.window.move({ workspace = "r-1" }))

restricted_bind(mainMod .. " + S", hl.dsp.workspace.toggle_special("special"))
restricted_bind(mainMod .. "+ALT + S", hl.dsp.window.move({ workspace = "special:special", follow = false }))

restricted_bind(mainMod .. "+SHIFT + S", hl.dsp.exec_cmd(paths.shell_quote(paths.config("hypr/scripts/hyprland/screenshot.sh")) .. " edit"))
restricted_bind("Print", hl.dsp.exec_cmd(paths.shell_quote(paths.config("hypr/scripts/hyprland/screenshot.sh")) .. " screen"))
restricted_bind("CTRL + Print", hl.dsp.exec_cmd(paths.shell_quote(paths.config("hypr/scripts/hyprland/screenshot.sh")) .. " save"))

restricted_bind(mainMod .. "+SHIFT + C", hl.dsp.exec_cmd("pgrep -x hyprpicker >/dev/null 2>&1 || hyprpicker -a"))

hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ 5%+"), { repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ 5%-"), { repeating = true })
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("ags request -i ags-bar osd-output-mute >/dev/null 2>&1; wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true })
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("ags request -i ags-bar osd-input-mute >/dev/null 2>&1; wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"), { locked = true })
hl.bind(mainMod .. "+SHIFT + M", hl.dsp.exec_cmd("ags request -i ags-bar osd-output-mute >/dev/null 2>&1; wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true })
hl.bind(mainMod .. "+ALT + M", hl.dsp.exec_cmd("ags request -i ags-bar osd-input-mute >/dev/null 2>&1; wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"), { locked = true })

hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl set 5%+"), { repeating = true })
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl set 5%-"), { repeating = true })

hl.bind(mainMod .. "+SHIFT + N", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind(mainMod .. "+SHIFT + B", hl.dsp.exec_cmd("playerctl previous"), { locked = true })
hl.bind(mainMod .. "+SHIFT + P", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })
hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })

hl.bind(mainMod .. " + L", hl.dsp.exec_cmd(paths.shell_quote(paths.config("hypr/scripts/hyprlock/launch.sh"))), { locked = true })
hl.bind("XF86PowerOff", hl.dsp.exec_cmd("ags toggle -i ags-bar power-menu"))
hl.bind(mainMod .. "+SHIFT + L", hl.dsp.exec_cmd("systemctl suspend"), { locked = true })
hl.bind("CTRL+ALT + Delete", hl.dsp.exec_cmd("ags toggle -i ags-bar power-menu"))
hl.bind(mainMod .. " + Escape", hl.dsp.exec_cmd("ags toggle -i ags-bar power-menu"))

hl.bind(mainMod .. " + Minus", hl.dsp.exec_cmd("hyprctl keyword cursor:zoom_factor $(hyprctl getoption cursor:zoom_factor -j | grep -oP '(?<=\"float\": )[0-9.]+' | awk '{printf \"%.1f\", $1 - 0.3}')"), { repeating = true })
hl.bind(mainMod .. " + Equal", hl.dsp.exec_cmd("hyprctl keyword cursor:zoom_factor $(hyprctl getoption cursor:zoom_factor -j | grep -oP '(?<=\"float\": )[0-9.]+' | awk '{printf \"%.1f\", $1 + 0.3}')"), { repeating = true })

hl.define_submap("lock", function()
    hl.bind("Left",  hl.dsp.exec_cmd("playerctl previous"),   { locked = true })
    hl.bind("Right", hl.dsp.exec_cmd("playerctl next"),       { locked = true })
    hl.bind("Up",    hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
    hl.bind("Down",  hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
end)
