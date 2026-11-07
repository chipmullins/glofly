-- Glofly Whitelist: lets players into your FiveM / RedM server by their Glofly constellation
-- membership and roles. Free and open source. https://glofly.app/docs/api
fx_version 'cerulean'
games { 'gta5', 'rdr3' }
rdr3_warning 'I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.'
lua54 'yes'

name 'glofly-whitelist'
author 'Glofly'
description 'Whitelist and role sync from a Glofly constellation'
version '1.0.0'

server_scripts {
  'config.lua',
  'server/http.lua',
  'server/card.lua',
  'server/main.lua'
}

server_exports {
  'GetPlayer',
  'HasRole'
}
