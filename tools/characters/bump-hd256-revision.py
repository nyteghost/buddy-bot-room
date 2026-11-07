#!/usr/bin/env python3
"""Make a reviewed-update copy of an HD256 v3 character ZIP with a higher revision.

Usage: python3 -I tools/characters/bump-hd256-revision.py --revision 2 --output NEW_DIR PACK.zip [PACK.zip ...]

Use it when a pack's content changed (timing, metadata, clips) but it reuses a character ID that may
already be installed at a lower revision: the Character Library only offers a reviewed update for a
higher revision and never silently replaces an installed ID. Only `revision` in
character-pack.json changes; every other entry (all PNG art) is copied byte for byte. The output
folder must not exist, and refuses to lower or keep a revision. Generated packs may contain private
art: keep them out of git.
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path


def bump(source, target, revision):
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read('character-pack.json'))
        if manifest.get('format') != 'pixel-pals-character-addon' or manifest.get('version') != 3:
            raise ValueError(f'{source.name}: not an HD256 v3 character pack')
        changed = []
        for character in manifest['characters']:
            old = int(character.get('revision', 1))
            if revision <= old:
                raise ValueError(f"{source.name}: {character['id']} is already revision {old}")
            character['revision'] = revision
            changed.append((character['id'], old))
        with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_STORED) as out:
            for info in archive.infolist():
                data = (json.dumps(manifest, indent=1, ensure_ascii=False) + '\n').encode() if info.filename == 'character-pack.json' else archive.read(info)
                copy = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                copy.external_attr = info.external_attr
                out.writestr(copy, data)
    with zipfile.ZipFile(target) as check, zipfile.ZipFile(source) as original:
        assert check.testzip() is None
        for name in original.namelist():
            if name != 'character-pack.json' and check.read(name) != original.read(name):
                raise ValueError(f'{target.name}: {name} changed while copying')
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('packs', nargs='+', type=Path)
    parser.add_argument('--revision', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 2 <= args.revision <= 1_000_000:
        sys.exit('revision must be 2..1000000')
    if args.output.exists():
        sys.exit(f'{args.output} already exists; choose a new folder.')
    args.output.mkdir(parents=True)
    for pack in args.packs:
        for character, old in bump(pack, args.output / pack.name, args.revision):
            print(f'{pack.name}: {character} revision {old} -> {args.revision}')


if __name__ == '__main__':
    main()
