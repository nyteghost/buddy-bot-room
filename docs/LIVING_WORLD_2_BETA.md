# Living World 2 — theme-wide animated rooms (first implementation)

Living World now opens by default for all existing theme families and nine existing Pals. The original Classic room remains selectable via a device-local toggle. The existing OfficePal walker, reduced-motion settings, hidden-tab/low-power pauses and focus/task cues remain the foundation. Existing native 32×32 sprite models are used for generated eight-direction 32px fallback views and four stepping phases. These are not bespoke hand-drawn eight-angle sprite sheets; Saiyan's original directional art is preserved in Classic mode. Dungeon Crawler Carl has dedicated fantasy pixel art instead of the unrelated Hellraiser fallback.

Each room keeps its original backdrop but now layers ambient light, floating pixel specks, moving reflections and shadows, with separate lighting colors for themes. These effects are decorative, not live weather or animated furniture. They do not call AI or request extra permissions.

Desktop Home defaults to Today on the left and Pal Room on the right. Existing explicitly saved custom layouts are respected; mobile remains single-window with Today as its opening tab. The layout preset can also be selected manually.

Outstanding milestones: independently hand-illustrated 8-direction sprite sheets for all existing characters and themes; pathfinding/collisions that fit each room's floorplan; animated interactive props and real-time day/night/weather; Character Library with activation and original character packs (including the green-jacket Pal); deep mobile and Unraid performance QA. There is no change to the AI provider/model catalog, Discord connections, memory stores, Obsidian data, secrets, recordings or Docker volumes. Nothing is deployed to production here.

## Second increment: native character and scene performance

World characters now render directly at 32×32, with cached SVG runs, preserving recognizable jagged pixels at any screen scale. Theme-sensitive pixel props and idle gestures keep the room animated without AI calls; reduced motion and low power pause them. Animated furniture interactions, actual obstacle maps and authored sprite sheets remain outstanding.

## Original Green Jacket character pack

The first Character Library entry is a native 32px original design referencing the user's green/blue jacket character: bald crown, grey beard, red lanyard, lime upper jacket, cobalt blue lower jacket. It walks, waves and hides in a theme-matched hedge, rack or portal. The user can disable the visual-only pack from Pal Room. This is not a new AI agent or an imported animated GIF; expanding the library to user-supplied character asset packs and permissioned AI personalities remains a separate roadmap milestone.

## Scene time of day

Ambient room lighting now uses the viewer's browser-local hour to shift gently from morning through night; nighttime introduces small pixel stars. It runs at most once per minute while the room is active, with existing low-power and hidden-tab handling. It does not use location, remote weather, AI, or credentials. Weather-linked effects and true furniture interaction remain roadmap work.

## Character Universe movement milestone

Dedicated walkable floor plans and collision zones now exist for each theme. Pal foot paths use bounded, deterministic eight-direction A* routes around furniture with per-character timing and idle/wave moments; existing office choreography is retained in Linux/Assistant/Dev Team. This is authored collision geometry for the room decor but has not been visually calibrated against every backdrop on a physical display. Paths avoid fixed objects, not real-time collisions with moving user-created furniture or other Pals.

## Animated character atlas

All nine established AI Pal identities now have complete generated per-theme animation atlases: eight directions, nine gestures and four frame phases, rendered at native 32×32. The base models are distinct authored pixel silhouettes; gesture and direction frames are synthesized by original pixel-geometry rules (not 2,880 independently hand-painted PNG images). Classic portrait assets remain unchanged. More elaborate hand-painted/cinematic animation packs may be offered later without replacing this feature.

## Expanded fan and original character roster

The optional visual roster now includes two **unofficial, original pixel-art fan tributes** (Goku and Homer), plus six original theme-flexible guest designs (Moon Mage, Arcade Ghost, Space Ranger, Pixel Robot, Tiny Dragon and Dungeon Knight). They travel obstacle-aware routes, wave when clicked, and contain no AI model, tool permission or external assets. Green Jacket remains the only enabled-by-default guest; additional guests are opt-in in Character Library.

## Custom Character Creator and cross-device Library

The Character Universe now provides a 32×32 pixel editor, color palette, live preview, editable names, save/delete, and safe data-only JSON import/export. A built-in catalog of nine visual guests can be enabled/disabled with a six-visitor limit. A signed-in **owner** can save custom characters and enabled selection to BUDDY_DATA_DIR/character-universe.json through an authenticated, revision-checked API. Local browser copies remain usable as offline backups; if sync fails the UI clearly reports browser-local-only status. Files never execute scripts or load external assets. Character packs remain decorative and cannot add AI providers, memory or tool access. Existing nine AI Pal identities and Classic mode are preserved.

## Weather and responsive scene interactions

Live weather from the already configured RoomLive weather API now drives decorative rain/snow/cloud/fog/storm effects around the scene window. Missing weather remains clear and makes no extra request. Each visible original Pal can be selected or keyboard-activated to wave; the Pal Room includes Wave to Everyone and Celebrate Together visual emotes. These actions never call an AI endpoint, send messages, change memory, or perform unattended work.

## Beta: room-wide visual-visitor reactions

In Pal Room activities, **Wave to everyone** and **Celebrate together** keep their existing effect on the original Pals and now also animate **enabled** Green Jacket, built-in guest packs and custom 32×32 visitors. An individual Pal's tap-to-wave stays targeted to that Pal; clicking a guest still waves only that guest.

These reactions reuse the existing local four-frame sprite atlas. They expire after 1.6 seconds, accept only validated cosmetic cues, and are suppressed by reduced-motion or low-power preferences. No new chat messages, Ollama calls, Discord events, Obsidian notes, memories, tasks, external requests or AI permissions are created.

This integration adds unit and React rendering tests, but it **is not a claim of a fully completed Living Universe**. TypeScript, CI, production-equivalent build, browser smoke and iPhone/desktop appearance must pass before deploying a new beta image. The extended inspect-prop/greet event kinds and separate AI-identity permissions are not connected to user actions yet.
