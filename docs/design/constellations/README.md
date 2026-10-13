# Constellations (Glofly 2.0) — design source

The approved mockups from the "Glofly Constellations" design canvas (Oct 12–13, 2026). Chip signed
off on these, the two animations especially: **build them exactly like this.** The full plan is the
Messenger project doc `glofly-2.0-plans.md`.

| File | Screen |
|---|---|
| `Main.dc.html` | Normal Glofly with the **Constellations** button (galaxy icon) under Friends and Groups |
| `Transition.dc.html` | **The animations**: starry swipe in (click Constellations) and the firefly swarm back (click Back to Glofly); also the night sky with wandering fireflies |
| `Dashboard.dc.html` | Constellations dashboard: cards, Create / Join, Invites, twinkling sky, 5 wandering fireflies |
| `Create.dc.html` | The **+**: Create (icon, name, templates) / Join with an invite |
| `Constellation.dc.html` | Inside a constellation: icon strip with Home, profile at the top, categories + nebulas, chat, members by role |
| `VoiceNebula.dc.html` | A voice nebula with group video and a live screen share |
| `Roles.dc.html` | Constellation settings: roles and permissions |

The files are the design canvas's own format (HTML with `<x-dc>` markup and a small `Component`
class). Everything that matters for the build is plain CSS and plain JS inside them: the
`<helmet><style>` blocks (keyframes, timings, colors) and the `Component` class (star field,
swarm and wandering-firefly code). Lift those into the desktop app; phones re-create the same
timings with Reanimated.
