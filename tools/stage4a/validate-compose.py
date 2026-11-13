#!/usr/bin/env python3
"""Validate *rendered* Stage 4A Compose JSON, without accessing the Docker daemon.
Read only:  STAGE4A_... docker compose -f docker-compose.unraid-stage4a-test.yml config --format json | python3 tools/stage4a/validate-compose.py
Do NOT print rendered config: it contains the disposable setup code.
"""
import json
import re
import sys

def check():
    cfg=json.load(sys.stdin)
    assert cfg.get("name")=="pixelpals-stage4a-test", "unexpected project"
    services=cfg.get("services",{})
    assert set(services)=={"stage4a"}, "exactly one isolated service required"
    app=services["stage4a"]
    image=app["image"]
    assert re.fullmatch(r"ghcr\.io/nyteghost/buddy-bot-room@sha256:[0-9a-f]{64}",image), "image not pinned to a full digest"
    ports=app.get("ports",[])
    assert len(ports)==1 and str(ports[0].get("published"))=="8091" and int(ports[0].get("target"))==8090, "host port must be 8091 only"
    assert ports[0].get("host_ip") not in ("0.0.0.0","::",""), "wildcard public bind forbidden"
    assert app.get("network_mode") not in ("host","none") and not app.get("privileged"), "unsafe networking or privilege"
    assert set(app.get("networks",{}))=={"stage4a-private"}, "must not join other Docker networks"
    private=cfg.get("networks",{}).get("stage4a-private",{})
    assert private.get("internal") is True, "egress-blocking internal bridge required"
    mounts=app.get("volumes",[])
    assert len(mounts)==3, "expected 3 disposable volumes"
    assert {m["target"] for m in mounts}=={"/data","/backups","/vault"} and all(m.get("type")=="volume" for m in mounts), "no bind mounts allowed"
    assert set(cfg.get("volumes",{}))=={"stage4a-data","stage4a-backups","stage4a-vault"}, "no foreign volumes allowed"
    e=app.get("environment",{})
    assert e.get("BUDDY_ACCOUNTS")=="1" and len(e.get("BUDDY_PASSWORD") or "")>=12, "test account setup code required"
    for k,v in {"LOCAL_ONLY_AI":"on","STRATA_ENABLED":"off","OLLAMA_URL":"","STRATA_API_KEY":"","GITHUB_TOKEN":"","UPDATE_CHECK":"0","MODEL_FEED":"0","PROVIDER_FEED":"0","GITHUB_JOURNAL_ENABLED":"0","NVIDIA_VISIBLE_DEVICES":"none"}.items():
        assert e.get(k)==v, f"{k} must be locked down"
    assert app.get("restart") in ("no",None), "no auto-start after reboot"
    assert "ALL" in app.get("cap_drop",[]) and any("no-new-privileges:true"==s for s in app.get("security_opt",[])), "security options missing"
    print("Stage 4A Compose static isolation checks PASS: digest-pinned, 8091 only, private bridge, 3 dedicated volumes, no provider credentials.")
if __name__=="__main__":
    try: check()
    except Exception as exc:
        print("Stage 4A Compose isolation checks FAILED: "+str(exc),file=sys.stderr)
        raise SystemExit(1)
