#!/usr/bin/env python3
"""Package the supplied Living Universe handoff without modifying its artwork.

Usage: python tools/characters/build-hd256-pack.py --source HANDOFF --output NEW_DIR
Requires Pillow. Output must not exist; never overwrites an earlier delivery.
All packs remain prototypes. Only supplied poses are exposed: no invented wave,
celebration, additional walk frames, or AI/tool permissions. Artwork stays private.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image

DIRECTIONS = ('s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw')
ANCHORS = ('carl', 'jason', 'violet')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def source_bytes(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f'Unsafe or missing source: {name}')
    return path.read_bytes()

def clip(files, duration, loop):
    return {'frames': [{'file': f, 'durationMs': duration} for f in files], 'loop': loop}

def convert(root, source):
    with zipfile.ZipFile(io.BytesIO(source_bytes(root, source['betaImportZip']))) as archive:
        old = json.loads(archive.read('character-pack.json'))
    if len(old['characters']) != 1 or old['characters'][0]['id'] != source['id']:
        raise ValueError(f"Existing beta ID mismatch: {source['slug']}")
    poses = source.get('poses', {})
    directions = {}
    for direction in DIRECTIONS:
        if direction not in source['directions']:
            continue
        idle = poses.get('idle', {}).get(direction, source['directions'][direction])
        actions = {'idle': clip([idle], 1000, True)}
        if 'walk_a' in poses and 'walk_b' in poses:
            actions['walk'] = clip([poses['walk_a'][direction], poses['walk_b'][direction]], 175, True)
        for action in ('run', 'emote', 'signature'):
            if direction in poses.get(action, {}):
                actions[action] = clip([poses[action][direction]], 1000, action == 'run')
        directions[direction] = actions
    if 's' not in directions:
        raise ValueError('South idle is required')
    slug = source['slug']
    movement = {'donut': 'quadruped', 'tairn': 'quadruped', 'cradle-orthos': 'quadruped',
                'cradle-dross': 'floating', 'cradle-little-blue': 'floating',
                'imani': 'flying', 'samantha': 'rolling'}.get(slug, 'humanoid')
    limitations = ('Two supplied walking frames per direction. Run, emote and signature are single poses; no full animation cycles or wave/celebration supplied.'
                   if poses else 'Idle poses only; no walking, wave or celebration animation supplied.')
    description = f"Prototype / QA pending. {source['series']}. {limitations} Directional views may contain mirrored or procedural poses. Owner approval required; data-only artwork grants no AI or tool permissions."
    return {'id': source['id'], 'name': source['name'], 'resolution': 256, 'revision': 1,
            'artStatus': 'prototype', 'description': description, 'movement': movement, 'directions': directions}

def write_pack(root, output, name, characters):
    manifest = {'format': 'pixel-pals-character-addon', 'version': 3, 'name': name, 'characters': characters}
    paths = sorted({frame['file'] for character in characters for actions in character['directions'].values()
                    for action in actions.values() for frame in action['frames']})
    entries = {'character-pack.json': (json.dumps(manifest, indent=2, ensure_ascii=False)+'\n').encode()}
    entries.update({path: source_bytes(root, path) for path in paths})
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_STORED) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for name, data in entries.items():
            if archive.read(name) != data:
                raise ValueError(f'Pack byte verification failed: {name}')
    return {'file': output.name, 'sha256': sha(output.read_bytes()), 'bytes': output.stat().st_size,
            'characters': [c['id'] for c in characters], 'pngEntries': len(paths), 'sourceBytesVerified': True}

def audit_images(root):
    records, groups = [], {}
    paths = sorted(list((root/'art/sprites').rglob('*.png')) + list((root/'art/poses').rglob('*.png')))
    for path in paths:
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as picture:
            picture.verify()
        with Image.open(io.BytesIO(data)) as picture:
            picture.load()
            alpha = picture.convert('RGBA').getchannel('A')
            bounds = alpha.getbbox()
            record = {'file': path.relative_to(root).as_posix(), 'sha256': sha(data), 'bytes': len(data),
                      'width': picture.width, 'height': picture.height, 'mode': picture.mode,
                      'alphaExtrema': list(alpha.getextrema()), 'alphaBounds': list(bounds) if bounds else None,
                      'hasTransparentPixels': alpha.getextrema()[0] == 0,
                      'touchesEdge': bool(bounds and (bounds[0] == 0 or bounds[1] == 0 or bounds[2] == picture.width or bounds[3] == picture.height))}
        if (record['width'], record['height']) != (256, 256) or not bounds or not record['hasTransparentPixels']:
            raise ValueError(f'Unexpected image dimensions/alpha: {record}')
        records.append(record)
        groups.setdefault(record['sha256'], []).append(record['file'])
    return {'pngCount': len(records), 'uniquePngHashes': len(groups), 'images': records,
            'duplicateHashGroups': [files for files in groups.values() if len(files) > 1]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.source.resolve()
    catalog = json.loads(source_bytes(root, 'manifest.json'))
    audit = audit_images(root)
    characters = {c['slug']: convert(root, c) for c in catalog['characters']}
    if len(characters) != 23 or audit['pngCount'] != 272:
        raise ValueError('This converter expects the original 23-character / 272-frame handoff')
    # Validate every referenced path before creating any deliverable.
    for c in characters.values():
        for actions in c['directions'].values():
            for action in actions.values():
                for frame in action['frames']:
                    source_bytes(root, frame['file'])
    args.output.mkdir(parents=True, exist_ok=False)
    packs = [write_pack(root, args.output/f'{slug}-hd256-v3-prototype.zip', f'HD256 Prototype - {c["name"]}', [c])
             for slug, c in characters.items()]
    packs.append(write_pack(root, args.output/'carl-jason-violet-hd256-v3-prototype.zip', 'HD256 Anchor Prototypes', [characters[s] for s in ANCHORS]))
    audit['packs'] = packs
    audit['existingBetaIdsPreserved'] = True
    (args.output/'asset-audit.json').write_text(json.dumps(audit, indent=2)+'\n')
    report = f'''# HD256 private prototype delivery\n\n23 individual v3 import ZIPs and one combined Carl/Jason/Violet ZIP.\nAll existing beta IDs preserved. Importing the combined pack and then individual\nanchor packs represents the same characters, not six independent characters.\n\n## Verified by converter\n\n- {audit['pngCount']} PNGs decode, are 256 x 256, contain nonempty art and transparent pixels.\n- {audit['uniquePngHashes']} unique SHA-256 hashes; {len(audit['duplicateHashGroups'])} duplicate groups.\n- Every archived PNG matches source bytes exactly; ZIP CRC checks pass.\n- Original artwork is never rewritten. See asset-audit.json for per-image hashes,\n  dimensions, alpha bounds, duplicate groups and output SHA-256 hashes.\n\n## Honest prototype scope\n\n- Carl, Jason and Violet: eight directions, single idle/run/emote/signature poses\n  and two supplied walking frames per direction. Run is a held pose, not a run cycle.\n- Twelve other characters: eight directional idle poses only.\n- Eight Cradle characters: south-facing idle only.\n- No fabricated wave, celebration, talk, turn or other missing animation clips.\n- Some directions are mirrored/procedural. Edge contact is recorded for review,\n  not automatically classified as clipping. Humanoid is the current biped\n  locomotion class, including Mongo; species-specific rigs remain future work.\n- All metadata is prototype; import requires owner review. No AI/tool grants.\n\n## Still required\n\nApplication importer, rendering, TypeScript/build, browser verification and owner\nvisual acceptance must be recorded separately; this converter does not prove them.\nPrivate artwork must not be committed to a public repository.\n'''
    (args.output/'README.md').write_text(report)
    print(json.dumps({'output': str(args.output), 'packs': len(packs), 'pngCount': audit['pngCount'], 'uniquePngHashes': audit['uniquePngHashes'], 'duplicateHashGroups': len(audit['duplicateHashGroups'])}))

if __name__ == '__main__':
    main()
