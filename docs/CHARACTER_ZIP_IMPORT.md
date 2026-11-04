# Import high-resolution characters with one ZIP — Pixel Pals beta

This adds a **Character Universe → Import character ZIP** button inside Pal Room.
It is a data-only visual character importer, **not** the executable Add-ons system, an AI agent installer, or a replacement for existing character art.

## Owner workflow

1. Open **Pal Room** and enable **Living World** if it is off.
2. Expand **Character Universe**.
3. Click **Import character ZIP**, select the ZIP you received, and preview each character.
4. Choose the characters you want and click **Approve & install**.
5. Imported characters appear in the Character Universe list. Click **Add** to have them walk around the Living World (up to six active visitors).

An owner-only, revision-checked operation installs all selected characters atomically. Existing IDs are never replaced through ZIP import, and an invalid ZIP installs nothing. The previous JSON import and 32x32 pixel editor continue to work. **The original 256x256 PNGs are preserved** and used for animated walking, waving, and celebrations.

## ZIP structure (v2 — 256×256 PNG artwork)

Use a standard single-disk ZIP with entries stored or deflate-compressed. Put the manifest at the ZIP root:

    character-pack.json
    lindon/idle.png
    lindon/walk-1.png
    lindon/walk-2.png
    lindon/wave.png
    lindon/celebrate.png

The manifest must be UTF-8 JSON with precisely the following data-only fields:

    {
      "format": "pixel-pals-character-addon",
      "version": 2,
      "name": "Example High-Res Characters",
      "characters": [
        {
          "id": "user-lindon2026",
          "name": "Lindon",
          "sprites": {
            "idle": "lindon/idle.png",
            "walk": ["lindon/walk-1.png", "lindon/walk-2.png"],
            "wave": ["lindon/wave.png"],
            "celebrate": ["lindon/celebrate.png"]
          }
        }
      ]
    }

Every PNG **must be exactly 256×256 pixels**; transparent RGBA PNG is recommended so the character blends with the room. The idle frame is required. Walking, waving, and celebrating frames are optional and can each contain 1–8 frames. Without optional action frames, the character displays idle artwork while moving. The character ID starts with user- followed by 8–40 lowercase letters or digits; keep an ID stable across exports.

The same ZIP can contain 1–12 characters. The total installed Character Universe remains limited to 12 custom characters. ZIPs must be smaller than 8 MiB, PNG entries smaller than 520 KB each (uncompressed), and combined embedded art under 2.4 million data-URL characters per character. The installer validates ZIP index bounds, compression, CRC, names, PNG headers, size, and the approved schema. It rejects traversal paths, executable files, unsupported encryption and unknown animation fields. The browser needs support for raw-deflate DecompressionStream for deflate-compressed ZIP entries; the ZIP STORE method works without it.

## Data safety and backups

The imported character data is stored under the existing private Unraid BUDDY_DATA_DIR/character-universe.json when signed in as owner. The existing Pixel Pals data backup copies this file if scheduled backups are configured; imported visual characters have no access to messages, saved memories, tools, or the ADHD Assistant bridge. When owner storage is unavailable, the app can use browser-local storage and warns that the result is local. Large HD packs may exceed browser-local storage quotas; use persistent Unraid storage and keep backups.

This v2 path imports visual PNG sprite frames, not skeletal rigs, model files, scripts, proprietary animation clips or autonomous pal personalities. Those require a distinct reviewed format and are not silently executed.
