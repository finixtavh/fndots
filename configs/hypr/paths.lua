
local M = {}

local home = os.getenv("HOME")
if not home or home == "" or home:sub(1, 1) ~= "/" then
	error("HOME must be set to an absolute path")
end

local function xdg_dir(variable, fallback)
	local value = os.getenv(variable)
	if value and value ~= "" and value:sub(1, 1) == "/" then
		return value
	end
	return fallback
end

function M.config(relative_path)
	return M.config_home .. "/" .. relative_path
end

function M.home_path(relative_path)
	return M.home .. "/" .. relative_path
end

function M.shell_quote(value)
	return "'" .. value:gsub("'", "'\"'\"'") .. "'"
end

M.home = home
M.config_home = xdg_dir("XDG_CONFIG_HOME", home .. "/.config")

return M
