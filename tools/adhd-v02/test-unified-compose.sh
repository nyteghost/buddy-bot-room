#!/usr/bin/env bash
# Validate the actual embedded migration template without Docker daemon, root, or live Unraid.
set -Eeuo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)"
TEMPDIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMPDIR"' EXIT
cat > "$TEMPDIR/docker-compose.yml" <<'COMPOSE'
name: pixelpals
services:
  buddy-bot:
    image: ghcr.io/nyteghost/buddy-bot-room:beta
    container_name: buddy-bot-room
    ports:
      - "8090:8090"
    environment:
      BUDDY_ACCOUNTS: "1"
      BUDDY_BACKUP_DIR: /backups
    volumes:
      - /mnt/user/appdata/pixelpals/data:/data
    extra_hosts:
      - host.docker.internal:host-gateway
  whisper:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
volumes:
  keep-me: {}
COMPOSE
# Extract the awk code actually used by the installer. Tests will fail if it moves/changes.
python3 - "$SELF/install-unified-stack.sh" "$TEMPDIR/render.sh" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
a=s.index('awk -v buddy="$BUDDY_SERVICE"')
needle="' \"$COMPOSE_FILE\" > \"$STAGED\""
b=s.index(needle,a)+len(needle)
header='''#!/usr/bin/env bash
set -Eeuo pipefail
BUDDY_SERVICE=buddy-bot
DATA=/mnt/user/appdata/adhd-assistant/data
APP=/mnt/user/appdata/adhd-assistant/code
BRIDGE_DIR=/mnt/user/appdata/adhd-assistant/bridge
GATEWAY=172.26.0.1
COMPOSE_FILE="$1"
STAGED="$2"
'''
Path(sys.argv[2]).write_text(header+s[a:b]+'\n')
PY
# Simulate an actual Compose Manager two-file project: retain the ordered override.
cat > "$TEMPDIR/docker-compose.override.yml" <<'OVERRIDE'
services:
  buddy-bot:
    environment:
      OTHER_SETTING_FROM_OVERRIDE: "untouched"
  auxiliary-service:
    image: busybox:latest
OVERRIDE
bash "$TEMPDIR/render.sh" "$TEMPDIR/docker-compose.yml" "$TEMPDIR/unified.yml"
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" -f "$TEMPDIR/docker-compose.override.yml" config --quiet
# Config must retain the original service/data and add the new service/secret.
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" -f "$TEMPDIR/docker-compose.override.yml" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)["services"]
assert {"buddy-bot","whisper","adhd-assistant","adhd-bridge","auxiliary-service"} <= set(c)
a=c["adhd-assistant"]
assert a["network_mode"]=="host"
assert a["read_only"] is True
bridge=c["adhd-bridge"]
assert not bridge.get("network_mode")
assert not bridge.get("ports")
assert any("default" in name for name in bridge.get("networks",{}))
assert bridge["read_only"] is True
assert bridge["user"]=="99:100"
assert bridge["command"]==["python","-B","/opt/bridge/bridge_v02.py","serve"]
assert any(v["target"]=="/opt/bridge/bridge_v02.py" and v["read_only"] for v in bridge["volumes"])
assert any(v["target"]=="/data" for v in bridge["volumes"])
assert any(v["target"]=="/data" for v in a["volumes"])
b=c["buddy-bot"]
assert b["environment"]["ADHD_BRIDGE_ENABLED"]=="1"
assert b["environment"]["OTHER_SETTING_FROM_OVERRIDE"]=="untouched"
assert b["environment"]["ADHD_BRIDGE_PEER_URL"]=="http://adhd-bridge:18766"
assert any(v["target"]=="/run/secrets/adhd_bridge_token" and v["read_only"] for v in b["volumes"])
assert any(v["target"]=="/data" for v in b["volumes"])
print("PASS: unified multi-file Compose retains overrides, services, mounts and secrets")
'
# Extract the very source-file selection used by the installer and check that only
# the base YAML (not the unrelated override) is chosen for the edit.
python3 - "$SELF/install-unified-stack.sh" "$TEMPDIR/select.sh" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
start=source.index('COMPOSE_FILE=""\nOWNERS=0\n')
end=source.index('cd "$COMPOSE_DIR"', start)
Path(sys.argv[2]).write_text("""#!/usr/bin/env bash
set -Eeuo pipefail
BUDDY_SERVICE=buddy-bot
COMPOSE_FILES=("$1" "$2")
fail(){ echo "$*" >&2; exit 1; }
"""+source[start:end]+'printf "%s\\n" "$COMPOSE_FILE"\n')
PY
selected="$(bash "$TEMPDIR/select.sh" "$TEMPDIR/docker-compose.yml" "$TEMPDIR/docker-compose.override.yml")"
[ "$selected" = "$TEMPDIR/docker-compose.yml" ] || { echo 'Unsafe multi-file edit target' >&2; exit 1; }
echo 'PASS: multi-file selection edits only the owning Compose source'

# The bridge must run without editing launch.py or loading the ordinary dashboard.
python3 -m py_compile "$SELF/bridge_v02.py"
python3 - "$SELF/bridge_v02.py" <<'PY'
import importlib.util, ipaddress, json, pathlib, sys, tempfile, threading
from urllib import request, error
source=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("bridge",source)
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
with tempfile.TemporaryDirectory() as directory:
    bridge.DB=pathlib.Path(directory)/"bridge.sqlite3"
    try:
        bridge.make_server({"bind":"127.0.0.1","allow":["127.0.0.0/8"],"port":18766},"x"*48)
        raise AssertionError("loopback must not be a valid production bridge bind")
    except ValueError:
        pass
    try:
        bridge.make_server({"bind":"0.0.0.0","allow":["172.26.0.0/16"],"port":18766},"x"*48)
        raise AssertionError("wildcard bind requires explicit Compose-only scope")
    except ValueError:
        pass
    internal=bridge.make_server({"bind":"0.0.0.0","allow":["172.26.0.0/16"],"port":18766,"scope":"compose_private"},"x"*48)
    internal.server_close()
    srv=bridge.BridgeServer(("127.0.0.1",0),bridge.Receiver)
    srv.allowed_networks=[ipaddress.ip_network("127.0.0.0/8")]
    srv.bridge_token="x"*48
    runner=threading.Thread(target=srv.serve_forever,daemon=True)
    runner.start()
    base="http://127.0.0.1:"+str(srv.server_port)
    def send(path,payload=None,secret=None):
        data=None if payload is None else json.dumps(payload).encode()
        headers={"Content-Type":"application/json"}
        if secret: headers["Authorization"]="Bearer "+secret
        req=request.Request(base+path,data=data,headers=headers)
        try:
            with request.urlopen(req,timeout=3) as response:
                return response.status,json.loads(response.read())
        except error.HTTPError as problem:
            return problem.code,json.loads(problem.read())
    assert send("/bridge/v1/capabilities")[0]==401
    assert send("/bridge/v1/capabilities",secret="x"*48)[0]==200
    msg={"id":"bridgeSmoke123","kind":"task","payload":{"title":"Beta smoke task"}}
    status,body=send("/bridge/v1/messages",msg,"x"*48)
    assert status==202 and body["status"]=="received_pending_approval"
    status,body=send("/bridge/v1/messages",msg,"x"*48)
    assert status==202 and body["duplicate"] is True
    status,body=send("/bridge/v1/handoffs/bridgeSmoke123",secret="x"*48)
    assert status==200 and body["state"]=="pending"
    srv.shutdown()
    srv.server_close()
print("PASS: authenticated standalone bridge serves, queues and deduplicates handoffs")
PY

# Regression: a preflight may succeed while the final Pixel Pals check still
# targets an obsolete host-gateway address. Both checks must use private DNS.
python3 - "$SELF/install-unified-stack.sh" <<'PY'
from pathlib import Path
import sys
script=Path(sys.argv[1]).read_text()
assert 'http://host.docker.internal:18766' not in script, "Old host-gateway endpoint remains"
assert 'http://adhd-bridge-preflight:18766/bridge/v1/capabilities' in script, "Private preflight probe missing"
final='docker exec "$PIXEL_CONTAINER" bun -e \'fetch("http://adhd-bridge:18766/bridge/v1/capabilities")'
assert final in script, "Final post-recreation check must use Docker service DNS"
assert "fail 'Bridge is not reachable through private Docker service DNS.'" in script
print("PASS: final private bridge check uses same Docker service DNS as installed Compose")
PY

# Read-only task intake preparation: future importer receives only owner-approved tasks.
python3 -B "$SELF/test_approved_task_export.py"
python3 -B "$SELF/test_approved_task_plan.py"
python3 -B "$SELF/test_reviewed_task_import.py"
python3 -B "$SELF/test_native_handoff_reconcile.py"
python3 -B "$SELF/test_native_pairing_preflight.py"
python3 -B "$SELF/test_native_local_intake.py"
