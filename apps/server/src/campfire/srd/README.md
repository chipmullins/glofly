# Campfire compendium data (SRD 5.1 and SRD 5.2)

Includes material from the System Reference Document 5.1 and the System Reference Document 5.2 by
Wizards of the Coast LLC, licensed under CC BY 4.0.

- License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/
- SRDs: https://dnd.wizards.com/resources/systems-reference-document
- Source of the JSON: the 5e-bits/5e-database project (https://github.com/5e-bits/5e-database; its
  code is MIT, the game content is the SRDs', under CC BY 4.0).
  - `monsters.json`, `spells.json` (SRD 5.1, the 2014 rules): `src/2014/en`, fetched Nov 9, 2026.
  - `2024/monsters.json`, `2024/spells.json` (SRD 5.2, the 2024 rules), `2014/` and `2024/`
    `builder.json` (species, classes, subclasses, backgrounds, feats) and `items.json` (armor,
    weapons, gear, magic items): made by `tools/campfire-srd/build.mjs`, fetched Nov 10, 2026.

The files are trimmed to what Campfire uses. Changes made: fields renamed and flattened, unused
fields dropped, 2024 Bonus Actions listed with the actions (named "… (Bonus Action)"), SRD 5.2
damage for higher slot levels and cantrip levels worked out from the spell's own words, nothing
reworded. `../srd.ts` maps a monster to a `Sheet5e`.

Wherever the compendium shows in the apps, show the credit line for the campaign's rules
(`creditFor(rules)` in `@glofly/shared`). Users never see the words "Dungeons & Dragons" or "D&D"
in Campfire: say "5e" or "fifth edition rules" (naming D&D Beyond only to say where an imported PDF
came from).
