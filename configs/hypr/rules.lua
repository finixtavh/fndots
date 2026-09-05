-- rules for windows
local disable_opacity_blur =
    require("user_settings").boolean("disableHyprlandOpacityBlur", false)

local window_opacity = disable_opacity_blur
    and "1.0 override 1.0 override"
    or "0.90 override 0.60 override"
hl.window_rule({ match = { class = ".*" }, opacity = window_opacity })
hl.window_rule({ match = { class = "^(code)" }, opacity = "1.0 override 1.0 override" })

local floating_titles = {
    "^(Open File)(.*)$",
    "^(Select a File)(.*)$",
    "^(Open Folder)(.*)$",
    "^(Save As)(.*)$",
    "^(Library)(.*)$",
    "^(File Upload)(.*)$"
}
for _, title in ipairs(floating_titles) do
    hl.window_rule({ match = { title = title }, float = true, center = true })
end

local floating_apps = { "pavucontrol" }
for _, app in ipairs(floating_apps) do
    hl.window_rule({
        match = { class = "^(" .. app .. ")$" },
        float = true,
        size = "45% 45%",
        center = true
    })
end

hl.window_rule({
    match = { title = "^([Pp]icture[-\\s]?[Ii]n[-\\s]?[Pp]icture)(.*)$" },
    float = true,
    keep_aspect_ratio = true,
    move = "73% 72%",
    size = "25% 25%",
    pin = true
})

hl.window_rule({
    match = { title = ".*is sharing (a window|your screen).*" },
    float = true,
    pin = true
})

hl.window_rule({ match = { title = ".*\\.exe" }, immediate = true })
hl.window_rule({ match = { class = "^(steam_app).*" }, immediate = true })
hl.window_rule({ match = { title = ".*minecraft.*" }, immediate = true })

hl.workspace_rule({ workspace = "special:special", gaps_out = 30 })

local layer_blur = not disable_opacity_blur
hl.layer_rule({ match = { namespace = "notifications" }, blur = layer_blur, ignore_alpha = 0.69 })
hl.layer_rule({ match = { namespace = "rofi" }, blur = layer_blur, ignore_alpha = 0.5 })
hl.layer_rule({ match = { namespace = "ags-bar" }, blur = layer_blur, ignore_alpha = 0.5, order = 10 })
hl.layer_rule({ match = { namespace = "ags-music-bar" }, blur = layer_blur, ignore_alpha = 0.5 })
hl.layer_rule({
    match = { namespace = "ags-now-listening" },
    blur = layer_blur,
    ignore_alpha = 0.5,
    animation = "slide top"
})
hl.layer_rule({
    match = { namespace = "ags-notif-center" },
    blur = layer_blur,
    ignore_alpha = 0.5,
    animation = "slide right"
})
hl.layer_rule({ match = { namespace = "ags-system-flyout" }, animation = "slide bottom", order = 0 })
hl.layer_rule({ match = { namespace = "ags-audio-mixer" }, animation = "slide bottom" })
hl.layer_rule({ match = { namespace = "ags-taskbar-menu" }, no_anim = true, blur = layer_blur })
hl.layer_rule({ match = { namespace = "power-menu" }, blur = layer_blur })

hl.layer_rule({ match = { namespace = "ags-osd" }, blur = layer_blur, ignore_alpha = 0.1 })
