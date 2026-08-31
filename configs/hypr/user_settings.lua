local M = {}
local paths = require("paths")

local settings = ""
local file = io.open(paths.config("ags/user-settings.json"), "r")
if file then
	settings = file:read("*a") or ""
	file:close()
end

function M.boolean(name, fallback)
	local escaped_name = name:gsub("(%W)", "%%%1")
	local value = settings:match('"' .. escaped_name .. '"%s*:%s*([%a]+)')
	if value == "true" then
		return true
	end
	if value == "false" then
		return false
	end
	return fallback == true
end

return M
