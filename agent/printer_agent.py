#!/usr/bin/env python3
"""Kanban print agent: pulls print jobs from the board, prints each task as a TSPL
label on a Gprinter GP-3120TL (203 dpi), passes raw jobs (TSPL already built by the
label editor) to the printer unchanged, and reports system stats. Stdlib only.

  printer_agent.py                 run the poll loop (config from environment)
  printer_agent.py --self-test     run built-in checks
  printer_agent.py --test-print    print one sample label (calibration)
  printer_agent.py --dump-label T  write the TSPL for a label titled T to stdout
"""
import base64
import binascii
import collections
import glob
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.error
import urllib.parse
import urllib.request

DOTS_PER_MM = 8  # 203 dpi
MARGIN = 2 * DOTS_PER_MM
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
HTTP_TIMEOUT = 30  # the server may spend up to ~15 s on a data-API append before answering
KEEP_DONE = 200  # finished job ids remembered so a lost ack never reprints
RESTARTED_ERROR = 'Agent restarted while printing; check the label and print again'
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
        # systemd's StateDirectory= sets STATE_DIRECTORY (colon-separated if several)
        'state_dir': (env.get('STATE_DIR', '').strip() or env.get('STATE_DIRECTORY', '').split(':')[0].strip()
                      or '/var/lib/kanban-print-agent'),
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

    urgency = clean(task.get('urgency')).upper()
    top = (urgency + '  ' if urgency else '') + clean(task.get('column')).upper() + '  #' + clean(task.get('id'))[:6]
    text(y, '1', top[:iw // 8])
    out.append('BAR %d,%d,%d,3' % (x, y + 14, iw))
    ty = y + 21
    # font, char width, line height (dots), field
    for font, cw, lh, field in (('3', 16, 26, 'title'), ('2', 12, 22, 'notes')):
        for line in wrap(clean(task.get(field)), iw // cw, (footer_y - 2 - ty) // lh):
            text(ty, font, line)
            ty += lh
    foot = []
    try:
        foot.append(time.strftime('%Y-%m-%d %H:%M', time.localtime(float(task.get('created')) / 1000)))
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    due = clean(task.get('due'))
    if due:
        foot.append('DUE ' + due)
    if foot:
        text(footer_y, '1', '  '.join(foot)[:iw // 8])
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


class PartialWrite(Exception):
    """Some bytes may have reached the printer before the error: never retried automatically."""


def send(target, data):
    """Write one job. OSError / SubprocessError mean nothing was sent (safe to retry later);
    PartialWrite means part of the job may have printed."""
    if target.startswith('tcp://'):
        with socket.create_connection(_tcp_addr(target), 10) as s:
            try:
                s.sendall(data)
            except OSError as e:  # sendall can't say how much went out
                raise PartialWrite('connection lost while sending (%s)' % e) from e
    elif target.startswith('cups:'):
        try:
            subprocess.run(['lp', '-d', target[5:], '-o', 'raw'], input=data, check=True, timeout=30,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except subprocess.TimeoutExpired as e:  # lp may have queued it anyway
            raise PartialWrite('lp timed out; the job may have been queued') from e
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b'').decode('utf-8', 'replace').strip()
            raise subprocess.SubprocessError('lp failed: %s' % (msg or 'exit status %d' % e.returncode)) from e
    else:
        # ponytail: a jammed USB printer can block this write; systemd restart is the escape hatch
        written = 0
        try:
            with open(target, 'wb', buffering=0) as f:
                view = memoryview(data)
                while view:
                    n = f.write(view) or 0
                    written += n
                    view = view[n:]
        except OSError as e:
            if written:
                raise PartialWrite('%s after %d of %d bytes' % (e, written, len(data))) from e
            raise


def decode_raw(raw):
    """Base64 from the server -> bytes for the printer, sent unchanged. ValueError if invalid."""
    if not isinstance(raw, str):
        raise ValueError('raw job payload is not a string')
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError('raw job payload is not valid base64')
    if not data:
        raise ValueError('raw job payload is empty')
    return data


def job_bytes(job, cfg):
    """Bytes to print for a poll item: {jobId, raw: base64} or {jobId, task: {...}}."""
    if 'raw' in job:
        return decode_raw(job['raw'])
    return build_label(job.get('task') if isinstance(job.get('task'), dict) else {}, cfg)


class State:
    """Finished results, unacknowledged results and the job being printed, kept in a JSON
    file (temp + fsync + rename) so a restart never reprints a job. OSError if unwritable."""

    def __init__(self, path):
        self.path = path
        self.done = collections.OrderedDict()  # jobId -> result, oldest first
        self.pending = []  # results not yet delivered to the server
        self.printing = None  # jobId being written to the printer right now
        self.send_error = None  # transient printer error to report once (not persisted)
        try:
            with open(path) as f:
                d = json.load(f)
        except FileNotFoundError:
            d = {}
        except ValueError as e:  # writes are atomic, so this means outside damage
            log('state file %s is corrupt, starting empty: %s' % (path, e))
            d = {}
        d = d if isinstance(d, dict) else {}
        for r in _results(d.get('done')):
            self.done[r['jobId']] = r
        self.pending = _results(d.get('pending'))
        printing = d.get('printing')
        if isinstance(printing, str) and printing:
            # crashed mid-write: the label may be half printed, so report instead of reprinting
            log('job %s failed: %s' % (printing, RESTARTED_ERROR))
            self.finish({'jobId': printing, 'ok': False, 'error': RESTARTED_ERROR})

    def save(self):
        tmp = self.path + '.tmp'
        data = json.dumps({'done': list(self.done.values()), 'pending': self.pending,
                           'printing': self.printing}).encode()
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
        fd = os.open(os.path.dirname(self.path) or '.', os.O_RDONLY)
        try:
            os.fsync(fd)  # make the rename itself durable
        finally:
            os.close(fd)

    def queue(self, r):
        if all(p['jobId'] != r['jobId'] for p in self.pending):
            self.pending.append(r)

    def start(self, jid):
        self.printing = jid
        self.save()

    def finish(self, r):
        self.done[r['jobId']] = r
        self.done.move_to_end(r['jobId'])
        while len(self.done) > KEEP_DONE:
            self.done.popitem(last=False)
        self.queue(r)
        self.printing = None
        self.save()

    def ack(self, n):
        """The server has the first n pending results."""
        if n:
            del self.pending[:n]
            self.save()


def _results(v):
    return [r for r in v if isinstance(r, dict) and isinstance(r.get('jobId'), str)
            and isinstance(r.get('ok'), bool)] if isinstance(v, list) else []


def open_state(cfg):
    os.makedirs(cfg['state_dir'], mode=0o700, exist_ok=True)
    return State(os.path.join(cfg['state_dir'], 'state.json'))


def _finish(state, r):
    try:
        state.finish(r)
    except OSError as e:  # result stays in memory; a restart reports the job failed, never reprints
        log('cannot save state: %s' % e)


def process_jobs(jobs, ready, state, cfg, send_fn=send):
    """Print new jobs; replay stored results for jobs already finished (lost ack).
    Jobs are skipped (left queued server-side) while the printer is not ready.
    A raw job with a bad payload fails on its own. A printer error stops the batch: if
    nothing reached the printer the job is left unacknowledged (the server redelivers it
    once the printer is back), otherwise it is reported failed. Returns this call's results;
    every result is also queued in state.pending until a poll delivers it."""
    results = []
    for job in jobs if isinstance(jobs, list) else []:
        jid = job.get('jobId') if isinstance(job, dict) else None
        if not isinstance(jid, str) or not jid:
            continue
        if jid in state.done:
            state.queue(state.done[jid])
            results.append(state.done[jid])
            continue
        if job.get('expired') is True:  # never printed and over an hour old: fail it, don't print it late
            r = {'jobId': jid, 'ok': False, 'error': 'Expired before the printer was ready'}
            log('job %s expired' % jid)
            _finish(state, r)
            results.append(r)
            continue
        if not ready:
            continue
        try:
            data = job_bytes(job, cfg)
        except ValueError as e:
            r = {'jobId': jid, 'ok': False, 'error': str(e)[:200]}
            log('job %s failed: %s' % (jid, r['error']))
            _finish(state, r)
            results.append(r)
            continue
        try:
            state.start(jid)  # on disk before any byte goes out
        except OSError as e:
            state.printing = None
            state.send_error = 'cannot save state: %s' % e
            log(state.send_error)
            break
        try:
            send_fn(cfg['printer'], data)
            r = {'jobId': jid, 'ok': True}
            log('printed %sjob %s' % ('raw ' if 'raw' in job else '', jid))
        except PartialWrite as e:
            r = {'jobId': jid, 'ok': False,
                 'error': ('Printer error part-way through the label (%s); check the label and print again' % e)[:200]}
            log('job %s failed: %s' % (jid, r['error']))
            ready = False  # leave the rest of the batch queued
        except (OSError, subprocess.SubprocessError) as e:
            # nothing was sent (printer off, unplugged, busy): leave the job unacknowledged
            state.printing = None
            state.send_error = (str(e) or type(e).__name__)[:200]
            log('job %s not printed, will retry: %s' % (jid, state.send_error))
            try:
                state.save()
            except OSError as e2:
                log('cannot save state: %s' % e2)
            ready = False
            continue
        except Exception as e:
            r = {'jobId': jid, 'ok': False, 'error': (str(e) or type(e).__name__)[:200]}
            log('job %s failed: %s' % (jid, r['error']))
            ready = False
        _finish(state, r)
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
    with _opener.open(req, timeout=HTTP_TIMEOUT) as r:
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
    try:
        state = open_state(cfg)
    except OSError as e:
        log('cannot use state directory %s: %s' % (cfg['state_dir'], e))
        return 2
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    log('agent started: server %s, printer %s' % (cfg['server'], cfg['printer']))
    delay, last_detail = cfg['poll'], None
    while not _stop:
        ready, detail = printer_status(cfg['printer'])
        if state.send_error:  # last send failed before any byte went out: back off one poll
            ready, detail = False, 'print failed, will retry: ' + state.send_error
            state.send_error = None
        if detail != last_detail:
            log('printer: ' + detail)
            last_detail = detail
        results = state.pending[:50]  # the server reads at most 50 per poll
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
        try:
            state.ack(len(results))
        except OSError as e:
            log('cannot save state: %s' % e)
        process_jobs(resp.get('jobs') if isinstance(resp, dict) else None, ready, state, cfg)
        _sleep(cfg['poll'])
    if state.pending:  # flush acks now; if this fails they are sent from the state file next start
        try:
            results = state.pending[:50]  # the server reads at most 50 per poll
            poll(cfg, {'stats': stats(), 'results': results,
                       'printer': {'ready': False, 'target': cfg['printer'], 'detail': 'agent stopping'}})
            state.ack(len(results))
        except Exception:
            pass
    log('agent stopped')
    return 0


# ---------------------------------------------------------------- CLI

def sample_task(title):
    return {'id': 'abc123def', 'title': title, 'column': 'Doing', 'urgency': 'high', 'created': time.time() * 1000,
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
    # urgency leads the header, the due date joins the footer
    lab4 = build_label({'id': 'abcdef12', 'title': 't', 'column': 'doing', 'urgency': 'high', 'due': '2026-11-02',
                        'created': 0}, cfg).decode('ascii')
    assert '"HIGH  DOING  #abcdef"' in lab4, lab4
    assert '  DUE 2026-11-02"' in lab4, lab4
    # server URL / token rules
    assert server_error(load_config({'SERVER_URL': 'http://example.com', 'AGENT_TOKEN': 't'}))
    assert server_error(load_config({'SERVER_URL': 'https://example.com'}))
    assert not server_error(load_config({'SERVER_URL': 'https://example.com', 'AGENT_TOKEN': 't'}))
    assert not server_error(load_config({'SERVER_URL': 'http://localhost:8080', 'AGENT_TOKEN': 't'}))
    assert load_config({})['state_dir'] == '/var/lib/kanban-print-agent'
    assert load_config({'STATE_DIRECTORY': '/a:/b'})['state_dir'] == '/a'
    assert load_config({'STATE_DIR': '/x', 'STATE_DIRECTORY': '/a'})['state_dir'] == '/x'
    with tempfile.TemporaryDirectory() as tmp:
        _self_test_jobs(load_config({'STATE_DIR': os.path.join(tmp, 'state')}))
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


class _Crash(BaseException):
    pass


def _self_test_jobs(cfg):
    st = open_state(cfg)
    path = st.path
    sent = []

    def ok(t, d):
        sent.append(d)

    # print once, replay result on re-send, skip when not ready
    r1 = process_jobs([{'jobId': 'a', 'task': {'title': 't'}}], True, st, cfg, ok)
    assert r1 == [{'jobId': 'a', 'ok': True}] and len(sent) == 1 and st.pending == r1
    r2 = process_jobs([{'jobId': 'a'}, {'jobId': 'b'}], False, st, cfg, ok)
    assert r2 == r1 and len(sent) == 1 and 'b' not in st.done and st.pending == r1
    # restart after print, before the ack reached the server: no reprint, ack still pending
    st = State(path)
    assert st.pending == r1 and 'a' in st.done and st.printing is None
    assert process_jobs([{'jobId': 'a', 'task': {}}], True, st, cfg, ok) == r1 and len(sent) == 1
    st.ack(1)
    assert State(path).pending == [] and 'a' in State(path).done
    # an expired job is failed, never printed late, even while the printer is not ready;
    # one that already printed keeps its stored result
    rx = process_jobs([{'jobId': 'x', 'raw': 'QUJD', 'expired': True}], False, st, cfg, ok)
    assert rx[0]['ok'] is False and 'Expired' in rx[0]['error'] and len(sent) == 1
    assert process_jobs([{'jobId': 'a', 'task': {}, 'expired': True}], True, st, cfg, ok)[0]['ok'] is True
    st.ack(len(st.pending))
    # crash mid-write: reported failed on restart, never reprinted

    def crash(t, d):
        raise _Crash()
    try:
        process_jobs([{'jobId': 'm', 'task': {}}], True, st, cfg, crash)
        raise AssertionError('crash not raised')
    except _Crash:
        pass
    st = State(path)
    rm = {'jobId': 'm', 'ok': False, 'error': RESTARTED_ERROR}
    assert st.printing is None and st.done['m'] == rm and st.pending == [rm], st.pending
    assert State(path).printing is None  # the failure itself was persisted
    assert process_jobs([{'jobId': 'm', 'task': {}}], True, st, cfg, ok) == [rm] and len(sent) == 1
    st.ack(len(st.pending))
    # transient error (printer power-cycling): job left unacked, rest of batch queued, retried later
    for exc in (OSError(19, 'No such device'), subprocess.SubprocessError('lp failed: busy')):
        def gone(t, d, exc=exc):
            raise exc
        r3 = process_jobs([{'jobId': 'b'}, {'jobId': 'c'}, {'jobId': 'a'}], True, st, cfg, gone)
        assert r3 == r1 and 'b' not in st.done and 'c' not in st.done and st.printing is None, r3
        assert st.send_error and State(path).printing is None and 'b' not in State(path).done
        st.send_error = None
    assert process_jobs([{'jobId': 'b'}], True, st, cfg, ok) == [{'jobId': 'b', 'ok': True}]
    # bytes may have reached the printer: reported failed, rest of the batch queued

    def partial(t, d):
        raise PartialWrite('EIO after 10 of 99 bytes')
    r4 = process_jobs([{'jobId': 'p'}, {'jobId': 'q'}], True, st, cfg, partial)
    assert len(r4) == 1 and not r4[0]['ok'] and 'EIO after 10' in r4[0]['error'] and 'q' not in st.done, r4
    # raw jobs: bytes go out unchanged, bad base64 fails that job only, finished ids dedupe
    tspl = b'SIZE 50 mm,30 mm\r\nCLS\r\nTEXT 10,10,"3",0,1,1,"\xff\x00"\r\nPRINT 1,1\r\n'
    sent = []
    r5 = process_jobs([{'jobId': 'r1', 'raw': base64.b64encode(tspl).decode()},
                       {'jobId': 'r2', 'raw': 'not base64!'}, {'jobId': 'r3', 'raw': ''},
                       {'jobId': 'r4', 'raw': 42}, {'jobId': 'r5', 'raw': 'QUJD'}],
                      True, st, cfg, ok)
    assert sent == [tspl, b'ABC'], sent
    assert [r['ok'] for r in r5] == [True, False, False, False, True], r5
    assert r5[1]['error'] == 'raw job payload is not valid base64', r5
    r6 = process_jobs([{'jobId': 'r1', 'raw': 'QUJD'}, {'jobId': 'r2', 'raw': 'QUJD'}], True, st, cfg, ok)
    assert r6 == r5[:2] and len(sent) == 2, r6
    # done list is bounded and survives a restart in order
    for i in range(KEEP_DONE + 5):
        st.done['x%d' % i] = {'jobId': 'x%d' % i, 'ok': True}
    _finish(st, {'jobId': 'last', 'ok': True})
    st = State(path)
    assert len(st.done) == KEEP_DONE and list(st.done)[-1] == 'last'
    assert oct(os.stat(path).st_mode & 0o777) == '0o600'
    # real send(): a missing device raises a plain (retryable) OSError, a file gets every byte
    dev = os.path.join(os.path.dirname(path), 'lp0')
    try:
        send(os.path.join(dev, 'missing'), b'x')
        raise AssertionError('no error')
    except PartialWrite:
        raise AssertionError('missing device must not count as a partial write')
    except OSError:
        pass
    send(dev, tspl)
    with open(dev, 'rb') as f:
        assert f.read() == tspl


def main(argv):
    try:
        cfg = load_config()
        # The token is in cfg now; keep it out of the environment that CUPS helpers inherit.
        os.environ.pop('AGENT_TOKEN', None)
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
