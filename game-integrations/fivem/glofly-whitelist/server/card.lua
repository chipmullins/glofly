-- Glofly Whitelist: the card in FiveM/RedM's connecting screen (approved "Glofly Whitelist card
-- in game" board): the community's name, where to type the code in Glofly, the code itself,
-- "Check again", and "Join with Discord instead" while the server runs 'both' mode and Discord
-- says yes.

GloflyCard = {}

function GloflyCard.link(communityName, code, withDiscord)
  local actions = {
    { type = 'Action.Submit', title = 'Check again', id = 'check', data = { glofly = 'check' } },
  }
  if withDiscord then
    actions[#actions + 1] = { type = 'Action.Submit', title = 'Join with Discord instead', id = 'discord', data = { glofly = 'discord' } }
  end
  return json.encode({
    type = 'AdaptiveCard',
    ['$schema'] = 'http://adaptivecards.io/schemas/adaptive-card.json',
    version = '1.3',
    body = {
      { type = 'TextBlock', text = ('Link your Glofly account to join %s'):format(communityName), weight = 'Bolder', size = 'Large', wrap = true },
      { type = 'TextBlock', text = 'Open Glofly, go to Settings → Linked game servers → Enter a code, and type:', wrap = true, spacing = 'Small' },
      { type = 'TextBlock', text = code, weight = 'Bolder', size = 'ExtraLarge', color = 'Accent', spacing = 'Medium', horizontalAlignment = 'Left' },
      { type = 'TextBlock', text = 'Works once, for 10 minutes · you\'ll join automatically once it\'s linked', isSubtle = true, wrap = true, size = 'Small' },
    },
    actions = actions,
  })
end
