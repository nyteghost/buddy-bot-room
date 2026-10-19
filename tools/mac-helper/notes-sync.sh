#!/bin/bash
# Pixel Pals — Mac Notes helper.
# Reads one Apple Note, sends it to your Pixel Pals server (/api/notes-sync) and writes the updated text back.
# It touches only the single note you name, and only talks to your own server. Nothing else on the Mac is read.
#
# Setup:  PP_URL="https://pixelpals.example.com" PP_TOKEN="pp_..." PP_NOTE="Watchlist" ./notes-sync.sh
#   PP_URL    your Pixel Pals address (no trailing slash)
#   PP_TOKEN  your access token (Pixel Pals > Connect iPhone > copy token; the same one the iPhone Shortcut uses)
#   PP_NOTE   exact title of the note
#   PP_LIST   optional Trakt list (default: your usual list)
#   PP_SKIP   optional number of heading lines to leave alone (default 1)
#   PP_DRY=1  show the result without changing the note
set -euo pipefail

: "${PP_URL:?Set PP_URL, for example https://pixelpals.example.com}"
: "${PP_TOKEN:?Set PP_TOKEN (copy it from Connect iPhone)}"
: "${PP_NOTE:?Set PP_NOTE to the exact title of the note}"
[[ "$PP_NOTE" == *'"'* || "$PP_NOTE" == *'\'* ]] && { echo "The note title can't contain quotes or backslashes." >&2; exit 2; }

query="format=note&skip=${PP_SKIP:-1}"
[[ -n "${PP_LIST:-}" ]] && query="$query&list=$(printf %s "$PP_LIST" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

osascript -e "tell application \"Notes\" to get plaintext of (first note whose name is \"$PP_NOTE\")" > "$tmp/in.txt" \
  || { echo "Couldn't read the note \"$PP_NOTE\". Check the title and allow Terminal to control Notes (System Settings > Privacy & Security > Automation)." >&2; exit 1; }

code="$(curl -sS -o "$tmp/out.txt" -w '%{http_code}' -X POST "$PP_URL/api/notes-sync?$query" \
  -H "Authorization: Bearer $PP_TOKEN" -H "Content-Type: text/plain; charset=utf-8" --data-binary @"$tmp/in.txt")"
if [[ "$code" != "200" ]]; then echo "Pixel Pals answered $code:" >&2; cat "$tmp/out.txt" >&2; exit 1; fi

if [[ "${PP_DRY:-}" == "1" ]]; then cat "$tmp/out.txt"; exit 0; fi

# Notes stores HTML, so turn each line into a <div> (escaping &, < and >).
python3 - "$tmp/out.txt" "$tmp/out.html" <<'PY'
import html, sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
open(sys.argv[2], "w", encoding="utf-8").write("".join(f"<div>{html.escape(l) if l else '<br>'}</div>" for l in lines))
PY

osascript - "$PP_NOTE" "$tmp/out.html" <<'AS'
on run argv
  set noteTitle to item 1 of argv
  set htmlText to read POSIX file (item 2 of argv) as «class utf8»
  tell application "Notes" to set body of (first note whose name is noteTitle) to htmlText
end run
AS
echo "Updated \"$PP_NOTE\"."
