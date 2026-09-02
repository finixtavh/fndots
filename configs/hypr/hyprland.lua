-- hyprland general config
local paths = require("paths")
local user_settings = require("user_settings")
local keyboard = require("keyboard")
local disable_opacity_blur = user_settings.boolean("disableHyprlandOpacityBlur", false)
local blur_enabled_by_default = false

hl.monitor({
    output = "eDP-1",
    mode = "highres@highrr",
    position = "0x0",
    scale = 1,
})
-- preset if you need more monitors
--hl.monitor({
--    output = "HDMI-A-1",
--    mode = "highres@highrr",
--    position = "0x0",
--    scale = 1,
--    mirror = "eDP-1",
--})

hl.env("XCURSOR_THEME", "Bibata-Modern-Classic")
hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("XDG_CURRENT_DESKTOP", "Hyprland")
hl.env("XDG_SESSION_TYPE", "wayland")
hl.env("XDG_SESSION_DESKTOP", "Hyprland")
hl.env("QT_QPA_PLATFORM", "wayland;xcb")
hl.env("QT_QPA_PLATFORMTHEME", "qt6ct")
hl.env("QT_WAYLAND_DISABLE_WINDOWDECORATION", "1")
hl.env("GDK_BACKEND", "wayland,x11")
hl.env("GTK_THEME", "Adwaita:dark")

hl.config({
	general = {
		gaps_in = 2,
		gaps_out = { top = 5, right = 1, bottom = 5, left = 1 },
		border_size = 1,
		col = {
			active_border = { colors = { "rgba(89b19eee)", "rgba(33473dee)" }, angle = 45 },
			inactive_border = "rgba(31313600)",
		},
		resize_on_border = true,
		allow_tearing = true,
		layout = "dwindle",
		no_focus_fallback = true,
	},

	decoration = {
		rounding = 3,
		rounding_power = 15,
		active_opacity = 1,
		inactive_opacity = disable_opacity_blur and 1 or 0.85,
		dim_inactive = true,
		dim_strength = 0.02,

		shadow = {
			enabled = false, -- TODO: change this to something better
			range = 20,
			render_power = 4,
			offset = "0 2",
			color = "rgba(00000033)",
		},

		blur = {
			enabled = blur_enabled_by_default and not disable_opacity_blur,
			xray = false,
			size = 10,
			passes = 3,
			brightness = 0.65,
			noise = 0.04,
			contrast = 0.6,
			vibrancy = 0.65,
			vibrancy_darkness = 1,
			popups = false,
		},
	},

	dwindle = {
		preserve_split = true,
		smart_split = true,
		smart_resizing = true,
	},

	misc = {
		force_default_wallpaper = 0,
		disable_hyprland_logo = true,
		disable_splash_rendering = true,
		vrr = 1,
		mouse_move_enables_dpms = true,
		key_press_enables_dpms = true,
		animate_manual_resizes = false,
		enable_swallow = true,
		swallow_regex = "^(kitty)$",
		focus_on_activate = true,
	},

	input = {
		kb_layout = keyboard.layout,
		kb_variant = "",
		kb_model = "",
		kb_options = "",
		kb_rules = "",
		numlock_by_default = true,
		repeat_delay = 250,
		repeat_rate = 35,
		follow_mouse = 1,
		sensitivity = 0,
		touchpad = {
			natural_scroll = true,
			disable_while_typing = true,
			clickfinger_behavior = true,
			scroll_factor = 0.7,
		},
	},

	binds = {
		scroll_event_delay = 0,
	},

	cursor = {
		hotspot_padding = 1,
	},
})

hl.on("hyprland.start", function()
	hl.exec_cmd(paths.shell_quote(paths.config("ags/scripts/launch-ags.sh")))
	hl.exec_cmd("/usr/lib/polkit-kde-authentication-agent-1")
	hl.exec_cmd("wl-paste --type text --watch cliphist store")
	hl.exec_cmd("wl-paste --type image --watch cliphist store")
	hl.exec_cmd("hyprctl setcursor Bibata-Modern-Classic 24")
	hl.exec_cmd("dbus-update-activation-environment --all")
	hl.exec_cmd(paths.shell_quote(paths.home_path("fn-apps/fnwall/restore.sh")))
	hl.exec_cmd(paths.shell_quote(paths.config("hypr/scripts/hyprland/start-hypridle.sh")))
	hl.exec_cmd("hyprsunset")
	local sunset_script = paths.shell_quote(paths.config("hypr/scripts/hyprland/apply-hyprsunset.sh"))
	hl.exec_cmd("sh -c " .. paths.shell_quote("sleep 0.6; exec " .. sunset_script))
	if user_settings.boolean("fnsessionAutostart", true) then
		hl.exec_cmd(paths.shell_quote(paths.home_path(".local/bin/fnsession")) .. " load")
	end
end)

require("animations")
require("rules")
require("keybinds")
