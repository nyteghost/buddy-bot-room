#!/usr/bin/env python3
"""Root process + recursive WebKit helper PSS/CPU sampler; no third-party Python deps."""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

def process_tree(root):
    parents = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            parents[int(entry.name)] = int(stat[1])
        except (OSError, IndexError, ValueError):
            continue
    tree = {root}
    while True:
        expanded = tree | {pid for pid, ppid in parents.items() if ppid in tree}
        if len(expanded) == len(tree):
            return {pid for pid in tree if pid in parents}
        tree = expanded

def cpu_jiffies(pid):
    try:
        stat = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
        return int(stat[11]) + int(stat[12])  # utime/stime (fields 14/15)
    except (OSError, IndexError, ValueError):
        return None

def pss_kib(pid):
    try:
        for line in (Path('/proc') / str(pid) / 'smaps_rollup').read_text().splitlines():
            if line.startswith('Pss:'):
                return int(line.split()[1])
    except (OSError, ValueError):
        return None
    return None

def webkit_processes(pids):
    """PIDs of WebKit helper processes, including the truncated /proc comm form."""
    found = []
    for pid in pids:
        try:
            process = (Path('/proc') / str(pid) / 'comm').read_text().strip()
            cmdline = (Path('/proc') / str(pid) / 'cmdline').read_bytes().replace(b'\\0', b' ').decode('utf-8', 'replace')
            if 'WebKit' in process or 'WebKit' in cmdline:
                found.append(pid)
        except OSError:
            continue
    return sorted(found)

def gpu_sample():
    try:
        out = subprocess.check_output(['nvidia-smi', '--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], text=True, stderr=subprocess.DEVNULL, timeout=3)
        return [{'gpuUtilPercent': float(row.split(',')[0]), 'systemVramUsedMiB': float(row.split(',')[1])} for row in out.strip().splitlines() if ',' in row]
    except (OSError, subprocess.SubprocessError, ValueError):
        return None

def measure(pid, seconds, interval, mode):
    clk = os.sysconf('SC_CLK_TCK')
    started = time.monotonic()
    last_t = None
    last_cpu = {}
    samples = []
    exited = False
    browser_seen = set()
    browser_exited = set()
    browser_last = set()
    while time.monotonic() - started < seconds:
        now = time.monotonic()
        tree = process_tree(pid)
        if pid not in tree:
            exited = True
            break
        browser_now = set(webkit_processes(tree))
        browser_exited.update(browser_last - browser_now)
        browser_last = browser_now
        browser_seen.update(browser_now)
        cpu = {p: v for p in tree if (v := cpu_jiffies(p)) is not None}
        pss = [v for p in tree if (v := pss_kib(p)) is not None]
        cpu_pct = None
        if last_t is not None and now > last_t:
            # Count only matching persistent processes, conservatively excluding new/exited children.
            ticks = sum(max(0, c - last_cpu[p]) for p, c in cpu.items() if p in last_cpu)
            cpu_pct = 100 * ticks / clk / (now - last_t)
        samples.append({'seconds': round(now - started, 3), 'processes': len(tree), 'webkitHelperPids': sorted(browser_now), 'cpuOneCorePercent': cpu_pct, 'pssMiB': round(sum(pss) / 1024, 2) if pss else None, 'pssObservedProcesses': len(pss), 'gpuSystemWide': gpu_sample()})
        last_t, last_cpu = now, cpu
        time.sleep(min(interval, max(.01, seconds - (time.monotonic() - started))))
    cpus = [s['cpuOneCorePercent'] for s in samples if s['cpuOneCorePercent'] is not None]
    psss = [s['pssMiB'] for s in samples if s['pssMiB'] is not None]
    return {'phase': mode, 'pid': pid, 'secondsRequested': seconds, 'secondsObserved': round(time.monotonic() - started, 2), 'processExitedDuringSample': exited, 'webkitHelperPidsObserved': sorted(browser_seen), 'webkitHelperPidsDisappeared': sorted(browser_exited), 'webKitHelperNeverObserved': not bool(browser_seen), 'cpuMeanOneLogicalCorePercent': round(statistics.mean(cpus), 2) if cpus else None, 'cpuPeakOneLogicalCorePercent': round(max(cpus), 2) if cpus else None, 'pssPeakMiB': max(psss) if psss else None, 'pssMeanMiB': round(statistics.mean(psss), 2) if psss else None, 'missingPss': any(s['pssObservedProcesses'] < s['processes'] for s in samples), 'gpuScope': 'system-wide, not process-attributed', 'samples': samples}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pid', required=True, type=int, help='Root Tauri process PID, not the browser dev server')
    p.add_argument('--seconds', type=float, default=60)
    p.add_argument('--interval', type=float, default=1)
    p.add_argument('--phase', choices=['idle', 'walk', 'soak'], required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    if args.seconds <= 0 or args.interval <= 0:
        p.error('seconds and interval must be positive')
    result = measure(args.pid, args.seconds, args.interval, args.phase)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'samples'}, indent=2))
    if result['processExitedDuringSample']:
        raise SystemExit(2)

if __name__ == '__main__':
    main()
