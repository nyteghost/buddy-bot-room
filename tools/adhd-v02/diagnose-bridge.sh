#!/usr/bin/env bash
# Read-only Unraid diagnosis for the already-rolled-back ADHD bridge sidecar.
# Starts a short-lived server to check bind/auth using read-only mounts.
set -Eeuo pipefail
BASE=/mnt/user/appdata/adhd-assistant
SOURCE="$BASE/bridge/bridge_v02.py"
DATA="$BASE/data"
say(){ printf '[ADHD bridge probe] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { say 'Run as root in the Unraid terminal'; exit 1; }
[ -f "$SOURCE" ] && [ -f "$DATA/bridge-v02.json" ] && [ -f "$DATA/bridge-v02-token" ] ||
  { say 'Expected bridge files not found. No containers were modified.'; exit 1; }
[ ! -L "$SOURCE" ] && [ ! -L "$DATA/bridge-v02-token" ] && [ ! -L "$DATA/bridge-v02.json" ] ||
  { say 'Unexpected symlink in bridge files; stopping.'; exit 1; }
say 'Containers are NOT being restarted. Secret value will NOT be printed.'
say 'Checking as the same unprivileged Docker user (99:100), with read-only mounts.'
docker run --rm --name adhd-bridge-probe --network host --user 99:100 \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=8m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ADHD_DATA_DIR=/data \
  -v "$SOURCE:/opt/bridge/bridge_v02.py:ro" -v "$DATA:/data:ro" \
  --entrypoint python python:3.12-alpine -B -c '
import json, runpy, sys, threading, urllib.request, urllib.error
from pathlib import Path
try:
    m = runpy.run_path("/opt/bridge/bridge_v02.py", run_name="bridge_probe")
    config = json.loads(Path("/data/bridge-v02.json").read_text())
    token = Path("/data/bridge-v02-token").read_text().strip()
    print("Bridge source: readable; configuration: readable; token: readable (value hidden)", flush=True)
    srv = m["make_server"](config,token)
    print("Listener: successfully bound to the configured private address", flush=True)
    try:
        thread=threading.Thread(target=srv.serve_forever,daemon=True)
        thread.start()
        req=urllib.request.Request("http://"+config["bind"]+":"+str(config["port"])+"/bridge/v1/capabilities")
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            response=opener.open(req,timeout=3)
            status=response.status
            server=response.headers.get("Server","")
            response.close()
        except urllib.error.HTTPError as error:
            status=error.code
            server=error.headers.get("Server","")
            error.close()
        print("Unauthenticated probe: HTTP",status,"Server:",server,flush=True)
        if not server.startswith("ADHDBridge/0.2-beta"):
            sys.exit("Unexpected bridge response identity")
        if status == 401:
            print("PASS: server starts and local probe receives authentication challenge",flush=True)
        elif status == 403:
            print("PASS: server starts; local host probe is outside the permitted Docker client CIDR",flush=True)
        else:
            sys.exit("Unexpected bridge HTTP status")
    finally:
        srv.shutdown()
        srv.server_close()
except Exception as error:
    print("FAIL: "+type(error).__name__+": "+str(error),flush=True)
    sys.exit(1)
'
say 'Probe complete; original application containers were untouched.'
