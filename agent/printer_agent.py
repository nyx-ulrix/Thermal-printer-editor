#!/usr/bin/env python3
"""Kanban print agent: pulls print jobs from the board, prints each task as a TSPL
label on a Gprinter GP-3120TL (203 dpi), and reports system stats. Stdlib only.

  printer_agent.py                 run the poll loop (config from environment)
  printer_agent.py --self-test     run built-in checks
  printer_agent.py --test-print    print one sample label (calibration)
  printer_agent.py --dump-label T  write the TSPL for a label titled T to stdout
"""
import collections
import glob
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.parse
import urllib.request

DOTS_PER_MM = 8  # 203 dpi
MARGIN = 2 * DOTS_PER_MM
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
_stop = False


def log(msg):
    print(msg, flush=True)  # journald adds the timestamp


# ---------------------------------------------------------------- config

def load_config(env=os.environ):
    def num(name, default, cast=float):
        return cast(env.get(name, '').strip() or default)
    return {
        'server': env.get('SERVER_URL', '').strip().rstrip('/'),
        'token': env.get('AGENT_TOKEN', '').strip(),
        'printer': env.get('PRINTER', '').strip() or '/dev/usb/lp0',
        'width': num('LABEL_WIDTH_MM', 40),
        'height': num('LABEL_HEIGHT_MM', 30),
        'gap': num('LABEL_GAP_MM', 2),
        'density': max(0, min(15, num('DENSITY', 8, int))),
        'speed': num('SPEED', 4),
        'direction': num('DIRECTION', 1, int),
        'off_x': num('OFFSET_X_DOTS', 0, int),
        'off_y': num('OFFSET_Y_DOTS', 0, int),
        'poll': max(1.0, num('POLL_SECONDS', 3)),
    }


def server_error(cfg):
    """Why we must not talk to this server, or None. Never mentions the token."""
    if not cfg['token']:
        return 'AGENT_TOKEN is empty'
    u = urllib.parse.urlsplit(cfg['server'])
    if u.scheme == 'https' and u.hostname:
        return None
    if u.scheme == 'http' and u.hostname in LOCAL_HOSTS:
        return None
    return 'SERVER_URL must be an https:// URL (plain http only for localhost), got %r' % cfg['server']


# ---------------------------------------------------------------- label (TSPL)

def clean(s):
    """Untrusted text -> one line of printable ASCII. Security boundary: no CR/LF can
    end the TEXT command early; quotes are escaped later in q()."""
    s = ' '.join(str(s if s is not None else '').split()).replace('\\', '/')
    return ''.join(c if ' ' <= c <= '~' else '?' for c in s)


def q(s):
    return '"' + s.replace('"', '\\["]') + '"'  # TSPL escape for a literal double quote


def wrap(s, width, max_lines):
    if not s or width < 1 or max_lines < 1:
        return []
    lines = textwrap.wrap(s, width)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:width - 1] + '~'
    return lines


def build_label(task, cfg):
    w, h = round(cfg['width'] * DOTS_PER_MM), round(cfg['height'] * DOTS_PER_MM)
    x, y = MARGIN + cfg['off_x'], MARGIN + cfg['off_y']
    iw = w - 2 * MARGIN
    footer_y = h - MARGIN + cfg['off_y'] - 12
    out = [
        'SIZE %g mm,%g mm' % (cfg['width'], cfg['height']),
        'GAP %g mm,0' % cfg['gap'] if cfg['gap'] else 'GAP 0,0',
        'DENSITY %d' % cfg['density'],
        'SPEED %g' % cfg['speed'],
        'DIRECTION %d' % cfg['direction'],
        'REFERENCE 0,0',
        'CLS',
    ]

    def text(ty, font, s):
        out.append('TEXT %d,%d,"%s",0,1,1,%s' % (x, ty, font, q(s)))

    top = clean(task.get('column')).upper() + '  #' + clean(task.get('id'))[:6]
    text(y, '1', top[:iw // 8])
    out.append('BAR %d,%d,%d,3' % (x, y + 14, iw))
    ty = y + 21
    # font, char width, line height (dots), field
    for font, cw, lh, field in (('3', 16, 26, 'title'), ('2', 12, 22, 'notes')):
        for line in wrap(clean(task.get(field)), iw // cw, (footer_y - 2 - ty) // lh):
            text(ty, font, line)
            ty += lh
    try:
        text(footer_y, '1', time.strftime('%Y-%m-%d %H:%M', time.localtime(float(task.get('created')) / 1000)))
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    out.append('PRINT 1,1')
    return ('\r\n'.join(out) + '\r\n').encode('ascii')


# ---------------------------------------------------------------- printer

def _tcp_addr(target):
    u = urllib.parse.urlsplit(target)
    return u.hostname, u.port or 9100


def printer_status(target):
    """(ready, human detail)."""
    try:
        if target.startswith('tcp://'):
            socket.create_connection(_tcp_addr(target), 2).close()
        elif target.startswith('cups:'):
            r = subprocess.run(['lpstat', '-p', target[5:]], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, universal_newlines=True, timeout=5)
            if r.returncode or 'disabled' in r.stdout:
                return False, ((r.stdout + r.stderr).strip() or 'lpstat failed')[:200]
        elif not os.path.exists(target):
            return False, target + ' not found'
        elif not os.access(target, os.W_OK):
            return False, 'no write permission on ' + target + ' (is the user in group lp?)'
        return True, 'ready'
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return False, str(e)[:200]


def send(target, data):
    if target.startswith('tcp://'):
        with socket.create_connection(_tcp_addr(target), 10) as s:
            s.sendall(data)
    elif target.startswith('cups:'):
        subprocess.run(['lp', '-d', target[5:], '-o', 'raw'], input=data, check=True, timeout=30,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    else:
        # ponytail: a jammed USB printer can block this write; systemd restart is the escape hatch
        with open(target, 'wb', buffering=0) as f:
            view = memoryview(data)
            while view:
                view = view[f.write(view):]


def process_jobs(jobs, ready, done, cfg, send_fn=send):
    """Print new jobs; replay stored results for jobs already finished (lost ack).
    Jobs are skipped (left queued server-side) while the printer is not ready."""
    results = []
    for job in jobs if isinstance(jobs, list) else []:
        jid = job.get('jobId') if isinstance(job, dict) else None
        if not isinstance(jid, str) or not jid:
            continue
        if jid in done:
            results.append(done[jid])
            continue
        if not ready:
            continue
        task = job.get('task') if isinstance(job.get('task'), dict) else {}
        try:
            send_fn(cfg['printer'], build_label(task, cfg))
            r = {'jobId': jid, 'ok': True}
            log('printed job %s' % jid)
        except Exception as e:
            r = {'jobId': jid, 'ok': False, 'error': (str(e) or type(e).__name__)[:200]}
            log('job %s failed: %s' % (jid, r['error']))
            ready = False  # leave the rest of the batch queued
        done[jid] = r
        while len(done) > 200:
            done.popitem(last=False)
        results.append(r)
    return results


# ---------------------------------------------------------------- stats

_prev_cpu = None


def _cpu():
    global _prev_cpu
    with open('/proc/stat') as f:
        v = [int(n) for n in f.readline().split()[1:9]]
    idle, total = v[3] + v[4], sum(v)
    pi, pt = _prev_cpu or (0, 0)  # first call: average since boot
    _prev_cpu = (idle, total)
    return round(100 * (1 - (idle - pi) / (total - pt)), 1) if total > pt else 0.0


def _mem():
    m = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':', 1)
            m[k] = int(v.split()[0])  # kB
    total, used = m['MemTotal'] / 1024, (m['MemTotal'] - m['MemAvailable']) / 1024
    return {'usedMb': round(used), 'totalMb': round(total), 'pct': round(100 * used / total, 1)}


def _disk():
    d = shutil.disk_usage('/')
    return {'usedGb': round(d.used / 2 ** 30, 1), 'totalGb': round(d.total / 2 ** 30, 1),
            'pct': round(100 * d.used / d.total, 1)}


def _temp():
    temps = []
    for p in glob.glob('/sys/class/thermal/thermal_zone*/temp'):
        try:
            with open(p) as f:
                temps.append(int(f.read()) / 1000)
        except (OSError, ValueError):
            pass
    return round(max(temps), 1) if temps else None


def _uptime():
    with open('/proc/uptime') as f:
        return int(float(f.read().split()[0]))


def _safe(fn):
    try:
        return fn()
    except Exception:  # stats are best-effort; never kill the loop over them
        return None


def stats():
    return {
        'host': socket.gethostname(),
        'cpu': _safe(_cpu),
        'mem': _safe(_mem),
        'disk': _safe(_disk),
        'load': _safe(lambda: [round(n, 2) for n in os.getloadavg()]),
        'tempC': _safe(_temp),
        'uptimeS': _safe(_uptime),
    }


# ---------------------------------------------------------------- server

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # never forward the bearer token to wherever a redirect points


_opener = urllib.request.build_opener(_NoRedirect)


def poll(cfg, body):
    req = urllib.request.Request(
        cfg['server'] + '/api/agent/poll', data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + cfg['token'], 'Content-Type': 'application/json',
                 'User-Agent': 'kanban-print-agent'})
    with _opener.open(req, timeout=15) as r:
        return json.loads(r.read() or b'{}')


def _on_signal(signum, frame):
    global _stop
    _stop = True


def _sleep(seconds):
    end = time.monotonic() + seconds
    while not _stop and time.monotonic() < end:
        time.sleep(0.2)


def run(cfg):
    err = server_error(cfg)
    if err:
        log('refusing to start: ' + err)
        return 2
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    log('agent started: server %s, printer %s' % (cfg['server'], cfg['printer']))
    done, results, delay, last_detail = collections.OrderedDict(), [], cfg['poll'], None
    while not _stop:
        ready, detail = printer_status(cfg['printer'])
        if detail != last_detail:
            log('printer: ' + detail)
            last_detail = detail
        body = {'stats': stats(), 'results': results,
                'printer': {'ready': ready, 'target': cfg['printer'], 'detail': detail}}
        try:
            resp = poll(cfg, body)
        except urllib.error.HTTPError as e:
            log('bad AGENT_TOKEN (HTTP 401)' if e.code == 401 else 'server error: HTTP %d' % e.code)
            _sleep(delay)
            delay = min(delay * 2, 60)
            continue
        except (OSError, ValueError) as e:  # URLError, timeouts, bad JSON
            log('server unreachable: %s' % getattr(e, 'reason', e))
            _sleep(delay)
            delay = min(delay * 2, 60)
            continue
        delay = cfg['poll']
        results = process_jobs(resp.get('jobs') if isinstance(resp, dict) else None, ready, done, cfg)
        _sleep(cfg['poll'])
    if results:  # flush acks so a restart doesn't reprint
        try:
            poll(cfg, {'stats': stats(), 'results': results,
                       'printer': {'ready': False, 'target': cfg['printer'], 'detail': 'agent stopping'}})
        except Exception:
            pass
    log('agent stopped')
    return 0


# ---------------------------------------------------------------- CLI

def sample_task(title):
    return {'id': 'abc123def', 'title': title, 'column': 'Doing', 'created': time.time() * 1000,
            'notes': 'Calibration sample: text should sit 2 mm inside every edge.'}


def self_test():
    cfg = load_config({})
    # injection, quotes, non-ASCII, header
    lab = build_label({'id': '1234567890', 'title': 'x"\r\nPRINT 9,9', 'notes': 'café ☕ \\["]',
                       'column': 'todo', 'created': 0}, cfg).decode('ascii')
    lines = lab.split('\r\n')
    assert lines[:2] == ['SIZE 40 mm,30 mm', 'GAP 2 mm,0'], lines[:2]
    assert [l for l in lines if l.startswith('PRINT')] == ['PRINT 1,1'], lines
    assert lab.endswith('PRINT 1,1\r\n')
    for l in lines:
        if l.startswith('TEXT'):
            assert l.replace('\\["]', '').count('"') == 4, l  # font + content strings only
    assert 'TODO  #123456"' in lab
    assert '"x\\["] PRINT 9,9"' in lab
    assert '"caf? ? /[\\["]]"' in lab
    # config-driven header, continuous media
    lab2 = build_label({}, load_config({'LABEL_WIDTH_MM': '50', 'LABEL_GAP_MM': '0'})).decode('ascii')
    assert lab2.startswith('SIZE 50 mm,30 mm\r\nGAP 0,0\r\nDENSITY 8\r\n'), lab2
    # wrapping + truncation: title fills the label, notes get no room
    lab3 = build_label({'title': 'word ' * 60, 'notes': 'zzz'}, cfg).decode('ascii')
    big = [l.split(',"3",0,1,1,', 1)[1][1:-1] for l in lab3.split('\r\n') if ',"3",' in l]
    assert len(big) == 6 and all(len(s) <= 18 for s in big) and big[-1].endswith('~'), big
    assert 'zzz' not in lab3
    # server URL / token rules
    assert server_error(load_config({'SERVER_URL': 'http://example.com', 'AGENT_TOKEN': 't'}))
    assert server_error(load_config({'SERVER_URL': 'https://example.com'}))
    assert not server_error(load_config({'SERVER_URL': 'https://example.com', 'AGENT_TOKEN': 't'}))
    assert not server_error(load_config({'SERVER_URL': 'http://localhost:8080', 'AGENT_TOKEN': 't'}))
    # job handling: print once, replay result on re-send, skip when not ready, stop batch on failure
    sent, done = [], collections.OrderedDict()
    r1 = process_jobs([{'jobId': 'a', 'task': {'title': 't'}}], True, done, cfg, lambda t, d: sent.append(d))
    assert r1 == [{'jobId': 'a', 'ok': True}] and len(sent) == 1
    r2 = process_jobs([{'jobId': 'a'}, {'jobId': 'b'}], False, done, cfg, lambda t, d: sent.append(d))
    assert r2 == r1 and len(sent) == 1 and 'b' not in done

    def jam(t, d):
        raise OSError('jam')
    r3 = process_jobs([{'jobId': 'b'}, {'jobId': 'c'}], True, done, cfg, jam)
    assert r3 == [{'jobId': 'b', 'ok': False, 'error': 'jam'}] and 'c' not in done, r3
    assert printer_status('/nonexistent/lp9') == (False, '/nonexistent/lp9 not found')
    # stats shape
    s = stats()
    assert set(s) == {'host', 'cpu', 'mem', 'disk', 'load', 'tempC', 'uptimeS'} and s['host']
    assert s['disk']['totalGb'] > 0
    json.dumps(s)
    if sys.platform.startswith('linux'):
        assert 0 <= s['cpu'] <= 100 and s['mem']['totalMb'] > 0 and len(s['load']) == 3 and s['uptimeS'] > 0, s
    else:
        print('(not Linux: /proc stats skipped)')
    print('self-test passed')
    return 0


def main(argv):
    try:
        cfg = load_config()
    except ValueError as e:
        log('bad config value: %s' % e)
        return 2
    cmd = argv[0] if argv else None
    if cmd == '--self-test':
        return self_test()
    if cmd == '--dump-label':
        sys.stdout.buffer.write(build_label(sample_task(' '.join(argv[1:]) or 'Sample label'), cfg))
        return 0
    if cmd == '--test-print':
        ready, detail = printer_status(cfg['printer'])
        if not ready:
            log('printer not ready: ' + detail)
            return 1
        send(cfg['printer'], build_label(sample_task('Test print - The quick brown fox jumps'), cfg))
        log('sample label sent to ' + cfg['printer'])
        return 0
    if cmd is None:
        return run(cfg)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
