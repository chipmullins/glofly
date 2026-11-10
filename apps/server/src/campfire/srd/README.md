# Campfire compendium data (SRD 5.1)

Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.

- License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/
- SRD 5.1: https://dnd.wizards.com/resources/systems-reference-document
- Source of the JSON: the 5e-bits/5e-database project (https://github.com/5e-bits/5e-database),
  files `src/2014/en/5e-SRD-Monsters.json` and `src/2014/en/5e-SRD-Spells.json` (its code is MIT;
  the game content is the SRD's, under CC BY 4.0), fetched Nov 9, 2026.

`monsters.json` and `spells.json` are those files trimmed to what Campfire's stat blocks and sheets
use (names, numbers, the text of traits and actions, damage dice). Changes made: fields renamed and
flattened, unused fields dropped, nothing reworded. `../srd.ts` maps a monster to a `Sheet5e`.

Wherever the compendium shows in the apps, show the credit line above (`SRD_CREDIT` in
`@glofly/shared`). Users never see the words "Dungeons & Dragons" or "D&D" in Campfire: say "5e"
or "fifth edition rules".
