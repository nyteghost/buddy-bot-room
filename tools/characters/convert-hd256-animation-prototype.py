#!/usr/bin/env python3
"""Package Character Designer animation prototypes as Pixel Pals HD256 v3 character ZIPs.

Usage:
  python3 -I tools/characters/convert-hd256-animation-prototype.py \
      --source ARCHIVE.zip [--source ARCHIVE2.zip ...] --output NEW_DIR [--ids ids.json] [--revision 2]

Reads three designer layouts straight from the archive (nothing is extracted or executed):
  * format "pixel-pals-hd256-character-pack"   frames[action][direction] = [png, ...]
  * format "pixel-pals-hd-asset-prototype"     animations[action] = {frames, frameDurationMs, pathPattern}
  * format "pixel-pals-hd-character-pack"      animations[action][direction] = [png, ...]

Rules (same as build-hd256-pack.py): PNG bytes are copied unchanged; every pack stays a
"prototype"; only supplied frames are exposed (no invented wave/celebration/walk frames,
no mirroring); the output folder must not exist; one ZIP per character. Pass --ids to keep the
IDs of characters the owner already installed so the Character Library offers a reviewed
version update (higher --revision) instead of a duplicate. Artwork stays private: never commit
the source archives or the generated ZIPs.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

DIRECTIONS = ('s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw')
V3_ACTIONS = ('idle', 'walk', 'run', 'turn', 'talk', 'wave', 'celebrate', 'emote', 'signature', 'rest', 'interaction')
# Designer action names → the closest Pixel Pals action. First match wins; extras are reported, not dropped silently.
ACTION_MAP = {
    'idle': 'idle', 'walk': 'walk', 'run': 'run', 'wave': 'wave', 'talk': 'talk', 'rest': 'rest',
    'celebrate': 'celebrate', 'laugh': 'celebrate', 'roar': 'celebrate', 'shout': 'celebrate', 'bounce': 'emote',
    'heal': 'interaction', 'potion': 'interaction', 'ritual': 'interaction',
    'strike': 'signature', 'pounce': 'signature', 'takeoff': 'signature', 'emote': 'emote', 'signature': 'signature',
}
# How non-walking movers travel: used as the walk clip only when no walk is supplied.
WALK_FALLBACK = ('roll', 'glide', 'fly', 'hover')
DEFAULT_MS = {'idle': 300, 'walk': 140, 'run': 95}
LOOPING = {'idle', 'walk', 'run', 'talk', 'rest'}
MOVEMENT = {'samantha': 'rolling', 'tairn': 'quadruped', 'dcc-mongo': 'quadruped', 'mongo': 'quadruped',
            'imani': 'flying', 'dcc-imani-obsidian-butterfly': 'flying', 'donut': 'quadruped', 'princess-donut': 'quadruped'}
MAX_PNG = 520_000
MAX_CLIP = 32
MAX_FRAMES = 512
SAFE_PART = re.compile(r'^[A-Za-z0-9._ -]+$')


def safe_member(name):
    parts = name.split('/')
    return (len(name) <= 160 and not name.startswith('/') and '\\' not in name
            and all(part and part not in ('.', '..') and SAFE_PART.match(part) for part in parts))


def png_ok(data):
    if len(data) > MAX_PNG or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return False
    width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', data[16:29])
    return width == 256 and height == 256 and depth == 8 and color in (2, 3, 4, 6) and interlace == 0


def frame_lists(manifest, base):
    """Return {designer_action: {direction: ([paths], durationMs or None)}} for a supported manifest."""
    fmt = manifest.get('format')
    out = {}
    if fmt == 'pixel-pals-hd256-character-pack':
        for action, per_dir in manifest.get('frames', {}).items():
            out[action] = {d: ([base + p for p in paths], None) for d, paths in per_dir.items() if isinstance(paths, list)}
    elif fmt == 'pixel-pals-hd-asset-prototype':
        for action, spec in manifest.get('animations', {}).items():
            count, pattern = int(spec.get('frames', 0)), spec.get('pathPattern', '')
            duration = spec.get('frameDurationMs')
            out[action] = {d: ([pattern.replace('{direction}', d).replace('{frame:02d}', f'{i:02d}') for i in range(count)], duration)
                           for d in DIRECTIONS}
    elif fmt == 'pixel-pals-hd-character-pack' and isinstance(manifest.get('animations'), dict) and \
            all(isinstance(v, dict) and all(isinstance(x, list) for x in v.values()) for v in manifest['animations'].values()):
        for action, per_dir in manifest['animations'].items():
            out[action] = {d: (paths, None) for d, paths in per_dir.items()}
    else:
        raise ValueError(f'unsupported manifest format {fmt!r}')
    return out


def convert(archive, member, ids, revision):
    manifest = json.loads(archive.read(member))
    base = member.rsplit('/', 1)[0] + '/' if '/' in member else ''
    source_id = str(manifest.get('characterId') or base.strip('/'))
    name = str(manifest.get('name') or source_id)[:40]
    lists = frame_lists(manifest, base)
    names = set(archive.namelist())
    signature_source = manifest.get('signatureAction')
    report = {'source': source_id, 'name': name, 'mapped': {}, 'unmapped': [], 'problems': []}
    chosen = {}
    for action, per_dir in lists.items():
        target = 'signature' if action == signature_source else ACTION_MAP.get(action)
        if not target or target in chosen:
            report['unmapped'].append(action)
            continue
        chosen[target] = (action, per_dir)
    for mover in WALK_FALLBACK:
        if 'walk' not in chosen and mover in lists:
            chosen['walk'] = (mover, lists[mover])
            report['unmapped'] = [a for a in report['unmapped'] if a != mover]
            report['walkFrom'] = mover
    files, directions, total = {}, {}, 0
    for direction in DIRECTIONS:
        actions = {}
        for target, (action, per_dir) in chosen.items():
            paths, duration = per_dir.get(direction, ([], None))
            paths = paths[:MAX_CLIP]
            frames = []
            for path in paths:
                if not safe_member(path) or path not in names:
                    report['problems'].append(f'missing or unsafe {path}')
                    continue
                data = archive.read(path)
                if not png_ok(data):
                    report['problems'].append(f'not a 256px 8-bit PNG under {MAX_PNG} bytes: {path}')
                    continue
                digest = hashlib.sha256(data).hexdigest()
                file = f'art/{digest[:24]}.png'
                files[file] = data
                frames.append({'file': file, 'durationMs': int(duration or DEFAULT_MS.get(target, 160))})
            if frames:
                actions[target] = {'frames': frames, 'loop': target in LOOPING}
                total += len(frames)
                report['mapped'].setdefault(target, {})[direction] = len(frames)
        if 'idle' in actions:
            directions[direction] = actions
        elif actions:
            report['problems'].append(f'{direction}: animation without idle skipped (v3 requires idle per direction)')
    if 's' not in directions:
        raise ValueError(f'{source_id}: south idle is required')
    if total > MAX_FRAMES:
        raise ValueError(f'{source_id}: {total} frame references exceeds {MAX_FRAMES}')
    slug = source_id.lower().replace('_', '-')
    character_id = ids.get(source_id) or ids.get(slug) or 'user-' + hashlib.sha256(slug.encode()).hexdigest()[:20]
    missing = [a for a in ('walk', 'wave', 'celebrate', 'signature', 'talk') if a not in chosen]
    limits = str(manifest.get('artLimitations') or manifest.get('sourceNotes') or '')
    quality = manifest.get('quality') if isinstance(manifest.get('quality'), dict) else {}
    method = str(quality.get('movementMethod', ''))
    description = (f"Prototype / QA pending. {manifest.get('series', '')}. Supplied 8-direction clips: "
                   f"{', '.join(sorted(chosen))}. Not supplied: {', '.join(missing) or 'none'}. {method} {limits}")
    description = re.sub(r'[\x00-\x1f<>]', ' ', description)[:1200]
    character = {'id': character_id, 'name': re.sub(r'[\x00-\x1f<>]', '', name), 'resolution': 256, 'revision': revision,
                 'artStatus': 'prototype', 'description': description,
                 'movement': MOVEMENT.get(slug, MOVEMENT.get(source_id, 'humanoid')), 'directions': directions}
    report.update({'id': character_id, 'frames': total, 'uniquePngs': len(files), 'missing': missing})
    return character, files, report


def write_pack(path, character, files):
    manifest = {'format': 'pixel-pals-character-addon', 'version': 3, 'name': character['name'] + ' HD256 animation prototype',
                'characters': [character]}
    with zipfile.ZipFile(path, 'x', compression=zipfile.ZIP_STORED) as out:
        for name, data in [('character-pack.json', (json.dumps(manifest, indent=1, ensure_ascii=False) + '\n').encode())] + sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            out.writestr(info, data)
    with zipfile.ZipFile(path) as check:
        assert check.testzip() is None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', action='append', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--ids', type=Path)
    parser.add_argument('--revision', type=int, default=2)
    args = parser.parse_args()
    if args.output.exists():
        sys.exit(f'{args.output} already exists; choose a new folder (earlier deliveries are never overwritten).')
    if not 1 <= args.revision <= 1_000_000:
        sys.exit('revision must be 1..1000000')
    ids = json.loads(args.ids.read_text()) if args.ids else {}
    args.output.mkdir(parents=True)
    reports, seen = [], set()
    for source in args.source:
        with zipfile.ZipFile(source) as archive:
            for member in sorted(archive.namelist()):
                if not member.endswith('manifest.json') or not safe_member(member):
                    continue
                try:
                    manifest = json.loads(archive.read(member))
                    frame_lists(manifest, '')
                except (ValueError, json.JSONDecodeError):
                    continue
                character, files, report = convert(archive, member, ids, args.revision)
                if character['id'] in seen:
                    reports.append({**report, 'skipped': 'duplicate of an earlier source'})
                    continue
                seen.add(character['id'])
                slug = re.sub(r'[^a-z0-9-]+', '-', report['source'].lower())
                write_pack(args.output / f'{slug}-hd256-v3-r{args.revision}.zip', character, files)
                reports.append({**report, 'archive': source.name})
    (args.output / 'conversion-report.json').write_text(json.dumps(reports, indent=1) + '\n')
    for report in reports:
        print(f"{report['source']:14} {report.get('skipped') or ''} frames={report.get('frames')} mapped={sorted(report['mapped'])} "
              f"missing={report.get('missing')} unmapped={report['unmapped']} problems={len(report['problems'])}")


if __name__ == '__main__':
    main()
