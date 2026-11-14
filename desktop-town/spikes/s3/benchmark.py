"""S3 isolated streaming and resource-control probe. Python standard library only."""
import argparse, http.client, ipaddress, json, math, os, threading, time, urllib.parse

POLICIES={"normal":(2,4,True),"gaming":(1,1,False),"paused":(0,0,False)}
class Cancelled(Exception): pass
class ProviderError(Exception): pass

def endpoint(base,allow_remote=False):
    u=urllib.parse.urlsplit(base)
    if u.scheme not in ("http","https") or not u.hostname or u.username or u.password or u.query or u.fragment or u.path.rstrip("/") not in ("","/v1"): raise ValueError("Invalid endpoint")
    try: ip=ipaddress.ip_address(u.hostname)
    except ValueError as e: raise ValueError("Literal IP required; DNS disabled") from e
    if ip.version!=4 or not (ip.is_loopback or (allow_remote and (ip.is_private or ip in ipaddress.ip_network("100.64.0.0/10")))): raise ValueError("Remote requires consent and private IPv4")
    return u

class Governor:
    def __init__(self,mode="normal"):
        if mode not in POLICIES: raise ValueError("Unknown mode")
        self.mode=mode; self.active=0; self.waiting=0; self.lock=threading.Condition()
    def set_mode(self,mode):
        if mode not in POLICIES: raise ValueError("Unknown mode")
        with self.lock: self.mode=mode; self.lock.notify_all()
    def acquire(self,cancel=None,timeout=5,background=False):
        deadline=time.monotonic()+timeout
        with self.lock:
            limit,queue,autonomous=POLICIES[self.mode]
            if not limit or (background and not autonomous): raise ProviderError("Inference paused")
            if self.active>=limit:
                if self.waiting>=queue: raise ProviderError("Queue full")
                self.waiting+=1
                try:
                    while self.active>=POLICIES[self.mode][0]:
                        if cancel is not None and cancel.is_set(): raise Cancelled()
                        if self.mode=="paused" or (background and not POLICIES[self.mode][2]): raise ProviderError("Inference paused")
                        remaining=deadline-time.monotonic()
                        if remaining<=0: raise TimeoutError("Queue timeout")
                        self.lock.wait(min(.025,remaining))
                finally: self.waiting-=1
            if cancel is not None and cancel.is_set(): raise Cancelled()
            self.active+=1
        return self.release
    def release(self):
        with self.lock:
            if self.active<=0: raise RuntimeError("Double release")
            self.active-=1; self.lock.notify_all()

def percentile(values,p):
    if not values: return None
    v=sorted(values); return v[max(0,min(len(v)-1,math.ceil(p*len(v))-1))]

def stream(base,model,prompt,timeout=30,allow_remote=False,key="",on_token=None,cancel=None,governor=None,background=False):
    u=endpoint(base,allow_remote)
    if not model or len(model)>160 or not all(c.isalnum() or c in "._:/@+-" for c in model): raise ValueError("Invalid model")
    if not .5<=timeout<=120: raise ValueError("Invalid timeout")
    cancel=cancel if cancel is not None else threading.Event()
    release=governor.acquire(cancel,timeout,background) if governor else None
    conn=None; start=time.monotonic(); first=None; chunks=0; usage=None; done=False
    try:
        if cancel.is_set(): raise Cancelled()
        conn=(http.client.HTTPSConnection if u.scheme=="https" else http.client.HTTPConnection)(u.hostname,u.port or (443 if u.scheme=="https" else 80),timeout=min(timeout,.1))
        body=json.dumps({"model":model,"messages":[{"role":"user","content":prompt}],"stream":True,"max_tokens":128,"stream_options":{"include_usage":True}})
        conn.request("POST","/v1/chat/completions",body,{"Content-Type":"application/json","Accept":"text/event-stream",**({"Authorization":"Bearer "+key} if key else {})})
        res=conn.getresponse()
        if res.status!=200: raise ProviderError("HTTP "+str(res.status))
        if "text/event-stream" not in res.getheader("content-type",""): raise ProviderError("Expected SSE")
        while True:
            if cancel.is_set(): raise Cancelled()
            if time.monotonic()-start>=timeout: raise TimeoutError("Generation deadline")
            try: line=res.readline(65537)
            except (TimeoutError,OSError):
                if cancel.is_set(): raise Cancelled()
                if time.monotonic()-start>=timeout: raise TimeoutError("Generation deadline")
                continue
            if len(line)>65536: raise ProviderError("Oversized SSE line")
            if not line: break
            if not line.startswith(b"data:"): continue
            payload=line[5:].strip()
            if payload==b"[DONE]": done=True; break
            obj=json.loads(payload)
            if isinstance(obj.get("usage"),dict) and isinstance(obj["usage"].get("completion_tokens"),int): usage=obj["usage"]["completion_tokens"]
            for choice in obj.get("choices",[]):
                content=(choice.get("delta") or {}).get("content")
                if content:
                    if first is None: first=time.monotonic()
                    chunks+=1
                    if on_token: on_token(content)
        if not done: raise ProviderError("Interrupted stream")
        end=time.monotonic()
        return {"ttft_ms":round((first-start)*1000,2) if first else None,"total_ms":round((end-start)*1000,2),"chunks":chunks,"completion_tokens":usage,"tokens_per_sec":round(usage/max(end-first,.001),2) if first and usage is not None else None}
    finally:
        if conn: conn.close()
        if release: release()

def run_matrix(base,models,runs,timeout,allow_remote=False,key="",mode="normal"):
    endpoint(base,allow_remote)
    if mode=="paused": raise ValueError("Paused cannot benchmark")
    results=[]
    for model in models:
        samples=[]
        for _ in range(runs):
            try: samples.append(stream(base,model,"Reply briefly with a friendly greeting.",timeout,allow_remote,key,governor=Governor(mode)))
            except Exception as e: samples.append({"error":type(e).__name__})
        valid=[x for x in samples if x.get("ttft_ms") is not None]
        results.append({"model":model,"first_request_ttft_ms_not_cold_load":valid[0]["ttft_ms"] if valid else None,"warm_ttft_p95_ms":percentile([x["ttft_ms"] for x in valid[1:]],.95),"successful":len(valid),"attempted":runs,"samples":samples,"cold_model_load_ms":None,"vram_mib":None,"fps_avg":None,"fps_1pct_low":None})
    return {"results":results,"hardware_acceptance":"NOT_TESTED","note":"First request does not prove cold model load; GPU and FPS require separate measurements."}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--base",default="http://127.0.0.1:1234/v1")
    p.add_argument("--model",action="append",required=True)
    p.add_argument("--runs",type=int,default=21)
    p.add_argument("--timeout",type=float,default=30)
    p.add_argument("--mode",choices=POLICIES,default="normal")
    p.add_argument("--allow-remote",action="store_true")
    p.add_argument("--output")
    a=p.parse_args()
    if not 2<=a.runs<=100: p.error("Runs must be 2..100")
    output=json.dumps(run_matrix(a.base,a.model,a.runs,a.timeout,a.allow_remote,os.environ.get("S3_API_KEY",""),a.mode),indent=2)
    if a.output:
        with open(a.output,"x",encoding="utf8") as f: f.write(output+"\n")
    print(output)
if __name__=="__main__": main()
