import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, cleanAgentReport, createBroker, emptyState, fileStore, safeReturn, signer, start, validRawPrint, validTask } from './server.mjs'

const SECRET = 's'.repeat(40)
const listen = (server) => new Promise((r) => server.listen(0, () => r(server.address().port)))

/** Raw request with full control of Host and no redirect following. */
function request(port, path, { method = 'GET', host = 'kanban.localhost', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path, method, headers: { host, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
  })
}

const cookieOf = (res, name) => (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`))

test('fold: create, move, print, finish, delete', () => {
  const s = emptyState()
  apply(s, { type: 'task.created', data: { id: 't1', title: 'A', column: 'todo', order: 1 }, ts: 1 })
  apply(s, { type: 'task.updated', data: { id: 't1', column: 'doing' }, ts: 2 })
  apply(s, { type: 'print.requested', data: { jobId: 'j1', taskId: 't1' }, ts: 3 })
  apply(s, { type: 'print.finished', data: { jobId: 'j1', ok: false, error: 'jam' }, ts: 4 })
  assert.equal(s.tasks.get('t1').column, 'doing')
  assert.equal(s.tasks.get('t1').updated, 2)
  assert.deepEqual(s.jobs.get('j1'), { id: 'j1', kind: 'task', taskId: 't1', status: 'failed', error: 'jam', requested: 3, ts: 4 })
  apply(s, { type: 'task.deleted', data: { id: 't1' }, ts: 5 })
  assert.equal(s.tasks.size, 0)
  assert.equal(s.jobs.size, 0)
})

test('fold: an old log raw payload lives outside the job and is dropped once printed', () => {
  const s = emptyState()
  apply(s, { type: 'print.requested', data: { jobId: 'r1', kind: 'raw', payload: 'QUJD', description: 'x' }, ts: 1 })
  assert.deepEqual(s.jobs.get('r1'), { id: 'r1', kind: 'raw', description: 'x', status: 'queued', error: null, requested: 1, ts: 1 })
  assert.equal(s.payloads.get('r1'), 'QUJD')
  apply(s, { type: 'print.finished', data: { jobId: 'r1', ok: true }, ts: 2 })
  assert.equal(s.payloads.has('r1'), false)
  assert.equal(s.jobs.get('r1').status, 'printed')
})

test('validation rejects bad input', () => {
  assert.throws(() => validTask({ title: '  ' }), /required/)
  assert.throws(() => validTask({ title: 'x'.repeat(141) }), /longer/)
  assert.throws(() => validTask({ title: 'ok', column: 'later' }), /column/)
  assert.throws(() => validTask({ order: Infinity }, true), /order/)
  assert.throws(() => validTask([], true), /object/)
  assert.deepEqual(validTask({ title: ' hi ', color: 'pink', extra: 1 }), { title: 'hi', color: 'pink' })
  const report = cleanAgentReport({ stats: { cpu: 400, host: 'h'.repeat(100) }, results: [{ jobId: 'j', ok: 'yes' }] })
  assert.equal(report.stats.cpu, 100)
  assert.equal(report.stats.host.length, 64)
  assert.equal(report.results[0].ok, false)
  assert.throws(() => validRawPrint({ payload: '' }), /empty/)
  assert.throws(() => validRawPrint({ payload: 'not base64!' }), /base64/)
  assert.throws(() => validRawPrint({ payload: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), (e) => e.status === 413)
  assert.throws(() => validRawPrint({ payload: 'QUJD', description: 'd'.repeat(141) }), /longer/)
  assert.deepEqual(validRawPrint({ payload: 'QUJD' }), { payload: 'QUJD', description: '' })
})

test('return paths stay on this site', () => {
  for (const ok of ['/', '/board', '/a/b?c=1#d', '/%2F%2Fevil.com']) assert.equal(safeReturn(ok), ok)
  for (const bad of ['//evil.com', '/\\evil.com', '/\tx', '/a\nb', '/a b', '/caf\u00e9', '/\u4e2d', 'https://evil.com', 'evil', '', null, '/x\x7f', `/${'a'.repeat(2001)}`]) {
    assert.equal(safeReturn(bad), '/', String(bad))
  }
})

test('signed cookies: tamper, wrong key and expiry rejected', () => {
  const a = signer(SECRET)
  const value = a.sign({ email: 'me@x.com', exp: Date.now() + 1000 })
  assert.equal(a.verify(value).email, 'me@x.com')
  const [body, mac] = value.split('.')
  const forged = Buffer.from(JSON.stringify({ email: 'evil@x.com', exp: Date.now() + 1000 })).toString('base64url')
  assert.equal(a.verify(`${forged}.${mac}`), null)
  assert.equal(a.verify(`${body}.${mac.slice(0, -2)}`), null)
  assert.equal(signer('t'.repeat(40)).verify(value), null)
  assert.equal(a.verify(a.sign({ email: 'me@x.com', exp: Date.now() - 1 })), null)
  assert.equal(a.verify('garbage'), null)
})

test('broker persists before fan-out, in order, and drops nothing on store failure', async () => {
  const written = []
  let fail = false
  const store = { append: async (e) => { if (fail) throw new Error('db down'); written.push(e.type) } }
  const s = emptyState()
  const seen = []
  const broker = createBroker(s, store)
  broker.subscribe('tasks', (e) => seen.push(e.type))
  await Promise.all([
    broker.publish('tasks', 'task.created', { id: 'a', title: 'A' }),
    broker.publish('tasks', 'task.updated', { id: 'a', title: 'B' })
  ])
  assert.deepEqual(written, ['task.created', 'task.updated'])
  assert.deepEqual(seen, written)
  fail = true
  await assert.rejects(broker.publish('tasks', 'task.deleted', { id: 'a' }))
  assert.equal(s.tasks.get('a').title, 'B')
})

test('refuses to start: missing Google settings, short agent token, open board on https or production', async () => {
  await assert.rejects(start({}), /GOOGLE_CLIENT_ID/)
  const google = { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', ALLOWED_EMAILS: 'a@b.c', SESSION_SECRET: SECRET }
  await assert.rejects(start({ ...google, SESSION_SECRET: 'short' }), /SESSION_SECRET/)
  await assert.rejects(start({ ...google, AGENT_TOKEN: 'x'.repeat(31) }), /AGENT_TOKEN/)
  await assert.rejects(start({ ALLOW_OPEN_BOARD: '1', KANBAN_ORIGIN: 'https://kanban.example.com' }), /local development only/)
  await assert.rejects(start({ ALLOW_OPEN_BOARD: '1', EDITOR_ORIGIN: 'https://editor.example.com' }), /local development only/)
  await assert.rejects(start({ ALLOW_OPEN_BOARD: '1', NODE_ENV: 'production' }), /local development only/)
  // A token endpoint override never reaches production.
  await assert.rejects(start({ ...google, GOOGLE_TOKEN_URL: 'http://127.0.0.1:1/t', NODE_ENV: 'production' }), /GOOGLE_TOKEN_URL/)
  await assert.rejects(start({ ...google, GOOGLE_TOKEN_URL: 'http://127.0.0.1:1/t', KANBAN_ORIGIN: 'https://k.example.com' }), /GOOGLE_TOKEN_URL/)
  await assert.rejects(start({ ...google, GOOGLE_TOKEN_URL: 'http://127.0.0.1:1/t', EDITOR_ORIGIN: 'https://e.example.com' }), /GOOGLE_TOKEN_URL/)
})

test('google sign-in: redirect, callback, allow list, state, server-side session, logout revokes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  // Stand-in for Google's token endpoint.
  let token = {}
  let lastForm
  const google = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      lastForm = new URLSearchParams(body)
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id_token: `${enc({ alg: 'RS256' })}.${enc(token)}.sig` }))
    })
  })
  const googlePort = await listen(google)
  const hooks = { tokenUrl: `http://127.0.0.1:${googlePort}/token` }
  const env = {
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csecret',
    ALLOWED_EMAILS: ' Me@Example.com , other@example.com',
    SESSION_SECRET: SECRET,
    KANBAN_ORIGIN: 'https://kanban.example.com',
    EDITOR_ORIGIN: 'https://editor.example.com',
    EVENTS_FILE: join(dir, 'events.jsonl'),
    EDITOR_DIR: join(dir, 'editor')
  }
  const server = await start(env, hooks)
  const port = await listen(server)
  const h = { 'X-Requested-With': 'kanban' }

  async function begin(host, back) {
    const res = await request(port, `/auth/login${back === undefined ? '' : `?return=${encodeURIComponent(back)}`}`, { host })
    assert.equal(res.status, 302)
    const loc = new URL(res.headers.location)
    return { res, loc, params: loc.searchParams, oauth: cookieOf(res, '__Host-oauth') }
  }
  const claimsFor = (params, extra = {}) => ({
    iss: 'https://accounts.google.com',
    aud: 'cid',
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: params.get('nonce'),
    email: 'me@example.com',
    email_verified: true,
    ...extra
  })
  const finish = (host, params, oauth, state = params.get('state')) =>
    request(port, `/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { host, headers: { cookie: oauth } })

  try {
    const anon = await request(port, '/api/me')
    assert.equal(anon.status, 401)
    assert.equal(anon.headers['strict-transport-security'], 'max-age=31536000')

    // Login redirect: every OAuth parameter; on https the cookie is __Host- (Secure, Path=/).
    const { res, loc, params, oauth } = await begin('editor.example.com', '/designs?x=1')
    assert.equal(`${loc.origin}${loc.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(params.get('client_id'), 'cid')
    assert.equal(params.get('redirect_uri'), 'https://editor.example.com/auth/callback')
    assert.equal(params.get('response_type'), 'code')
    assert.equal(params.get('scope'), 'openid email')
    assert.equal(params.get('prompt'), null) // no account chooser unless asked for
    assert.equal(params.get('login_hint'), null)
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.ok(params.get('state').length >= 32 && params.get('nonce').length >= 32)
    const setOauth = res.headers['set-cookie'][0]
    assert.match(setOauth, /^__Host-oauth=.*; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/)

    // Callback: code exchanged with secret + verifier, sid set, back to the return path.
    token = claimsFor(params)
    const done = await finish('editor.example.com', params, oauth)
    assert.equal(done.status, 302)
    assert.equal(done.headers.location, '/designs?x=1')
    assert.equal(lastForm.get('client_secret'), 'csecret')
    assert.equal(lastForm.get('redirect_uri'), 'https://editor.example.com/auth/callback')
    assert.equal(createHash('sha256').update(lastForm.get('code_verifier')).digest('base64url'), params.get('code_challenge'))
    const sidLine = done.headers['set-cookie'].find((c) => c.startsWith('__Host-sid='))
    assert.match(sidLine, /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800/)
    const sid = cookieOf(done, '__Host-sid')
    const me = await request(port, '/api/me', { headers: { cookie: sid } })
    assert.deepEqual(me.json, { email: 'me@example.com', kanbanUrl: 'https://kanban.example.com', editorUrl: 'https://editor.example.com' })
    // A fresh session is not renewed on use.
    assert.equal(me.headers['set-cookie'], undefined)

    // An unknown id, or the plain name on an https site, is not a session; a planted cookie next to
    // the real one does not shadow it.
    const unknown = `__Host-sid=${Buffer.alloc(32, 1).toString('base64url')}`
    assert.equal((await request(port, '/api/me', { headers: { cookie: unknown } })).status, 401)
    assert.equal((await request(port, '/api/me', { headers: { cookie: sid.replace('__Host-', '') } })).status, 401)
    assert.equal((await request(port, '/api/me', { headers: { cookie: `${unknown}; ${sid}` } })).status, 200)

    // The session survives a restart (stored server-side), and the store holds only its hash.
    const sessionFiles = await readdir(join(dir, 'sessions'))
    assert.equal(sessionFiles.length, 1)
    assert.equal(sessionFiles[0].includes(sid.split('=')[1]), false)
    const again = await start(env, hooks)
    const port2 = await listen(again)
    assert.equal((await request(port2, '/api/me', { headers: { cookie: sid } })).status, 200)
    again.close()

    // Kanban host uses its own origin; a hostile return path becomes '/'.
    const k = await begin('kanban.example.com', '//evil.com')
    assert.equal(k.params.get('redirect_uri'), 'https://kanban.example.com/auth/callback')
    token = claimsFor(k.params)
    assert.equal((await finish('kanban.example.com', k.params, k.oauth)).headers.location, '/')

    // login_hint: a plausible email is forwarded; junk is dropped; switch=1 asks for the chooser instead.
    const loginTo = async (qs) => new URL((await request(port, `/auth/login?${qs}`, { host: 'editor.example.com' })).headers.location).searchParams
    const hinted = await loginTo(`hint=${encodeURIComponent('Me@example.com')}`)
    assert.equal(hinted.get('login_hint'), 'Me@example.com')
    assert.equal(hinted.get('prompt'), null)
    for (const junk of ['not-an-email', 'a b@example.com', '<x>@y.z', `${'a'.repeat(250)}@example.com`, '']) {
      assert.equal((await loginTo(`hint=${encodeURIComponent(junk)}`)).get('login_hint'), null, junk)
    }
    const switched = await loginTo('switch=1&hint=me%40example.com')
    assert.equal(switched.get('prompt'), 'select_account')
    assert.equal(switched.get('login_hint'), null)
    assert.equal((await loginTo('switch=yes')).get('prompt'), null)

    // Bad state, missing cookie: 400 with a retry link back to where sign-in started.
    const r = await begin('kanban.example.com', '/x?y=1')
    const retry = await request(port, `/auth/callback?error=access_denied&state=${encodeURIComponent(r.params.get('state'))}`, {
      host: 'kanban.example.com',
      headers: { cookie: r.oauth }
    })
    assert.equal(retry.status, 400)
    assert.match(retry.text, /href="\/auth\/login\?return=%2Fx%3Fy%3D1"/)
    assert.match(retry.headers['content-security-policy'], /font-src https:\/\/fonts\.gstatic\.com/)
    assert.doesNotMatch(retry.headers['content-security-policy'], /script-src/)
    const s = await begin('kanban.example.com', '/')
    token = claimsFor(s.params)
    const bad = await finish('kanban.example.com', s.params, s.oauth, 'wrong')
    assert.equal(bad.status, 400)
    assert.match(bad.text, /href="\/auth\/login">Try again/) // no cookie of ours: nothing to return to
    assert.equal((await request(port, `/auth/callback?code=abc&state=${s.params.get('state')}`)).status, 400)

    // Wrong nonce or audience: 400.
    token = claimsFor(s.params, { nonce: 'other' })
    assert.equal((await finish('kanban.example.com', s.params, s.oauth)).status, 400)
    token = claimsFor(s.params, { aud: 'someone-else' })
    assert.equal((await finish('kanban.example.com', s.params, s.oauth)).status, 400)

    // Not on the list, or unverified: 403 naming the (escaped) account, no session.
    token = claimsFor(s.params, { email: '<b>x</b>@example.com' })
    const no = await finish('kanban.example.com', s.params, s.oauth)
    assert.equal(no.status, 403)
    assert.match(no.text, /&lt;b&gt;x&lt;\/b&gt;@example.com/)
    assert.match(no.text, /Use a different Google account/)
    assert.match(no.text, /href="\/auth\/login\?switch=1"/)
    assert.equal(cookieOf(no, '__Host-sid'), undefined)
    token = claimsFor(s.params, { email_verified: 'true' })
    assert.equal((await finish('kanban.example.com', s.params, s.oauth)).status, 403)

    // Editor pages need a session; logout needs the header.
    const page = await request(port, '/designs?x=1', { host: 'editor.example.com' })
    assert.equal(page.status, 302)
    assert.equal(page.headers.location, '/auth/login?return=%2Fdesigns%3Fx%3D1')
    assert.equal((await request(port, '/auth/logout', { method: 'POST' })).status, 403)
    const out = await request(port, '/auth/logout', { method: 'POST', headers: { ...h, cookie: sid } })
    assert.equal(out.status, 204)
    assert.match(out.headers['set-cookie'][0], /^__Host-sid=; .*Max-Age=0/)
    // Logout ends the session itself: a copy of the cookie no longer works.
    assert.equal((await request(port, '/api/me', { headers: { cookie: sid } })).status, 401)
    // Two sign-ins above (editor and kanban host); one is left.
    assert.equal((await readdir(join(dir, 'sessions'))).length, 1)
  } finally {
    server.close()
    google.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('http: task lifecycle, agent pull subscription, replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const server = await start({ ALLOW_OPEN_BOARD: '1', AGENT_TOKEN: 'tok', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor') })
  const base = `http://localhost:${await listen(server)}`
  const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' }
  try {
    assert.equal((await (await fetch(`${base}/api/me`)).json()).email, 'dev@localhost')
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST', body: '{"title":"x"}' })).status, 403)
    const task = await (await fetch(`${base}/api/tasks`, { method: 'POST', headers: h, body: '{"title":"Label run"}' })).json()
    assert.equal(task.column, 'todo')
    const job = await (await fetch(`${base}/api/tasks/${task.id}/print`, { method: 'POST', headers: h })).json()
    assert.equal(job.status, 'queued')
    assert.equal(job.kind, 'task')

    const poll = (body, token = 'tok') =>
      fetch(`${base}/api/agent/poll`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    assert.equal((await poll({}, 'wrong')).status, 401)
    // Printer not ready: the job stays queued.
    assert.deepEqual(await (await poll({ printer: { ready: false } })).json(), { jobs: [] })
    const { jobs } = await (await poll({ printer: { ready: true } })).json()
    assert.equal(jobs[0].task.title, 'Label run')
    assert.deepEqual(await (await poll({ printer: { ready: true } })).json(), { jobs: [] })
    await poll({ printer: { ready: true }, results: [{ jobId: jobs[0].jobId, ok: true }] })

    // A restart replays the log from disk.
    const again = await start({ ALLOW_OPEN_BOARD: '1', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor') })
    const res = await fetch(`http://localhost:${await listen(again)}/api/stream`)
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    const snap = JSON.parse(first.slice(first.indexOf('{')))
    assert.equal(snap.tasks[0].title, 'Label run')
    assert.equal(snap.jobs[0].status, 'printed')
    await reader.cancel()
    again.close()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('editor storage: cache and templates round trip through files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const env = { ALLOW_OPEN_BOARD: '1', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor') }
  const server = await start(env)
  const port = await listen(server)
  const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' }
  const put = (path, body) => request(port, path, { method: 'PUT', headers: h, body })
  try {
    assert.deepEqual((await request(port, '/api/editor/cache')).json, { values: {} })
    assert.deepEqual((await request(port, '/api/editor/templates')).json, { templates: [] })
    assert.equal((await put('/api/editor/cache/settings.v1', { value: { zoom: 2, name: 'a"b' } })).status, 204)
    assert.equal((await put('/api/editor/cache/gone', { value: 1 })).status, 204)
    assert.equal((await put('/api/editor/cache/gone', { value: null })).status, 204)
    assert.equal((await put('/api/editor/cache/templates', { value: 1 })).status, 400)
    assert.equal((await put('/api/editor/cache/..%2Fx', { value: 1 })).status, 400)
    assert.equal((await put('/api/editor/cache/k', {})).status, 400)
    assert.equal((await request(port, '/api/editor/cache/k', { method: 'PUT', body: '{"value":1}' })).status, 403)
    assert.equal((await put('/api/editor/templates', { templates: {} })).status, 400)
    assert.equal((await put('/api/editor/templates', { templates: [{ id: 't', items: [1, 2] }] })).status, 204)
    // Bigger than 64 KB is fine here, up to 8 MB.
    assert.equal((await put('/api/editor/cache/big', { value: 'x'.repeat(200_000) })).status, 204)
    assert.equal((await put('/api/editor/cache/huge', { value: 'x'.repeat(8 * 1024 * 1024) })).status, 413)

    // Concurrent writes to one key land in order.
    await Promise.all([1, 2, 3, 4, 5].map((n) => put('/api/editor/cache/count', { value: n })))
    assert.equal(await readFile(join(dir, 'editor', 'count.json'), 'utf8'), '5')

    // A restart reads the files back.
    server.close()
    const again = await start(env)
    const port2 = await listen(again)
    const cache = (await request(port2, '/api/editor/cache')).json.values
    assert.deepEqual(Object.keys(cache).sort(), ['big', 'count', 'settings.v1'])
    assert.deepEqual(cache['settings.v1'], { zoom: 2, name: 'a"b' })
    assert.deepEqual((await request(port2, '/api/editor/templates')).json, { templates: [{ id: 't', items: [1, 2] }] })
    again.close()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('editor site: static files, SPA fallback, caching, CSP, not built', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const dist = join(dir, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<!doctype html><p>editor</p>')
  await writeFile(join(dist, 'assets', 'app-1.js'), 'console.log(1)')
  await writeFile(join(dir, 'secret.txt'), 'nope')
  const env = { ALLOW_OPEN_BOARD: '1', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor'), WEB_DIST: dist }
  const server = await start(env)
  const port = await listen(server)
  const host = 'printer-editor.localhost:4173'
  try {
    const index = await request(port, '/', { host })
    assert.equal(index.status, 200)
    assert.match(index.text, /editor/)
    assert.equal(index.headers['cache-control'], 'no-cache')
    assert.match(index.headers['content-security-policy'], /script-src 'self'; .*worker-src 'self' blob:/)
    assert.match((await request(port, '/some/deep/route', { host })).text, /editor/)
    const js = await request(port, '/assets/app-1.js', { host })
    assert.equal(js.headers['cache-control'], 'private, max-age=31536000, immutable')
    assert.match(js.headers['content-type'], /javascript/)
    assert.equal((await request(port, '/assets/missing.js', { host })).status, 404)
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      assert.doesNotMatch((await request(port, path, { host })).text, /nope/, path)
    }
    // The kanban host still serves the board.
    assert.match((await request(port, '/', { host: 'kanban.localhost:4173' })).headers['content-security-policy'], /sha256-/)

    const missing = await start({ ...env, WEB_DIST: join(dir, 'nothing') })
    const port2 = await listen(missing)
    const res = await request(port2, '/', { host })
    assert.equal(res.status, 503)
    assert.match(res.text, /npm run build:web/)
    missing.close()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('editor printing: 409 without agent, raw job to the agent, payload never to browsers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const env = { ALLOW_OPEN_BOARD: '1', AGENT_TOKEN: 'tok', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor') }
  const server = await start(env)
  const port = await listen(server)
  const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' }
  const payload = Buffer.from('SIZE 40 mm,30 mm\r\nCLS\r\nPRINT 1\r\n').toString('base64')
  const print = (body) => request(port, '/api/editor/print', { method: 'POST', headers: h, body })
  const poll = (body) => request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body })
  try {
    assert.equal((await request(port, '/api/printer')).json.state, 'inactive')
    const busy = await print({ payload, description: 'Label' })
    assert.equal(busy.status, 409)
    assert.equal(busy.json.error, 'Print agent offline')
    assert.equal((await readFile(join(dir, 'events.jsonl'), 'utf8').catch(() => '')).includes('print.requested'), false)

    await poll({ printer: { ready: true, target: '/dev/usb/lp0' } })
    assert.equal((await request(port, '/api/printer')).json.state, 'ready')
    assert.equal((await print({ payload: 'bad!' })).status, 400)
    const queued = await print({ payload, description: 'Label' })
    assert.equal(queued.status, 202)
    const { job } = queued.json
    assert.deepEqual(Object.keys(job).sort(), ['description', 'error', 'id', 'kind', 'requested', 'status', 'ts'])
    assert.equal(job.kind, 'raw')
    assert.equal(job.status, 'queued')

    // The bytes go to their own store, never into the event log.
    const log = await readFile(join(dir, 'events.jsonl'), 'utf8')
    assert.equal(log.includes(payload), false)
    assert.deepEqual(JSON.parse(log.trim().split('\n').at(-1)).data, { jobId: job.id, kind: 'raw', description: 'Label' })
    assert.equal(await readFile(join(dir, 'payloads', `${job.id}.b64`), 'utf8'), payload)

    // Browsers never see the bytes: not in the job API, not in the snapshot.
    const fetched = await request(port, `/api/jobs/${job.id}`)
    assert.equal(fetched.json.job.status, 'queued')
    assert.equal(fetched.text.includes(payload), false)
    assert.equal((await request(port, '/api/jobs/nope')).status, 404)
    const stream = await fetch(`http://localhost:${port}/api/stream`)
    const reader = stream.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    assert.ok(first.includes(job.id))
    assert.equal(first.includes(payload), false)

    // The agent gets the raw bytes, then confirms.
    const { jobs } = (await poll({ printer: { ready: true } })).json
    assert.deepEqual(jobs, [{ jobId: job.id, raw: payload }])
    assert.equal((await request(port, `/api/jobs/${job.id}`)).json.job.status, 'sent')
    await poll({ printer: { ready: true }, results: [{ jobId: job.id, ok: true }] })
    assert.equal((await request(port, `/api/jobs/${job.id}`)).json.job.status, 'printed')
    await until(async () => (await readdir(join(dir, 'payloads'))).length === 0)

    // Replay: the job is printed and its payload is not resent.
    const again = await start(env)
    const port2 = await listen(again)
    assert.equal((await request(port2, `/api/jobs/${job.id}`)).json.job.status, 'printed')
    const replayPoll = await request(port2, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true } } })
    assert.deepEqual(replayPoll.json, { jobs: [] })
    again.close()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

const until = async (check, ms = 2000) => {
  for (const end = Date.now() + ms; !(await check()); ) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function openBoard(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const env = { ALLOW_OPEN_BOARD: '1', AGENT_TOKEN: 'tok', EVENTS_FILE: join(dir, 'events.jsonl'), EDITOR_DIR: join(dir, 'editor'), ...extra }
  return { dir, env }
}
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' }
const ev = (type, data, ts, id) => JSON.stringify({ ...(id && { id }), topic: type.split('.')[0] === 'task' ? 'tasks' : 'print', type, data, ts })

test('editor printing: a client jobId makes the request idempotent', async () => {
  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  const payload = Buffer.from('PRINT 1\r\n').toString('base64')
  const print = (body) => request(port, '/api/editor/print', { method: 'POST', headers: H, body })
  try {
    await request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true } } })
    const jobId = randomUUID()
    assert.equal((await print({ payload, jobId: 'not-a-uuid' })).status, 400)
    assert.equal((await print({ payload, jobId: jobId.toUpperCase() })).status, 400)
    const [a, b] = await Promise.all([print({ payload, jobId }), print({ payload, jobId })])
    assert.deepEqual([a.status, b.status].sort(), [200, 202])
    assert.equal(a.json.job.id, jobId)
    assert.equal(b.json.job.id, jobId)
    const again = await print({ payload, jobId })
    assert.equal(again.status, 200)
    assert.equal(again.json.job.id, jobId)
    const log = await readFile(join(dir, 'events.jsonl'), 'utf8')
    assert.equal(log.split('print.requested').length - 1, 1)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('file log: torn last line dropped, duplicate event ids skipped, mid-file corruption stops the boot', async () => {
  const { dir, env } = await openBoard()
  const file = env.EVENTS_FILE
  const t = Date.now()
  const created = ev('task.created', { id: 't1', title: 'A', column: 'todo', order: 1 }, t, 'e1')
  await writeFile(file, `${created}\n${created}\n${ev('task.updated', { id: 't1', title: 'B' }, t, 'e2')}\n{"topic":"tasks","ty`)
  const server = await start(env)
  const port = await listen(server)
  try {
    assert.equal(await readFile(file, 'utf8'), `${created}\n${created}\n${ev('task.updated', { id: 't1', title: 'B' }, t, 'e2')}\n`)
    // The next append lands on a clean line and the log replays.
    const add = await request(port, '/api/tasks', { method: 'POST', headers: H, body: { title: 'C' } })
    assert.equal(add.status, 201)
    server.close()
    const again = await start(env)
    const port2 = await listen(again)
    const res = await fetch(`http://localhost:${port2}/api/stream`)
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    again.close()
    const snap = JSON.parse(first.slice(first.indexOf('{')))
    assert.deepEqual(snap.tasks.map((x) => x.title).sort(), ['B', 'C'])
    assert.equal(snap.resources.server.events, 3)

    // A last line that is complete but missing its newline gets one before the next append.
    await writeFile(file, created)
    const third = await start(env)
    third.close()
    assert.equal(await readFile(file, 'utf8'), `${created}\n`)

    await writeFile(file, `${created}\n{broken\n${created}\n`)
    await assert.rejects(start(env), /corrupt/)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('print.sent survives a restart with its timestamp and resend grace', async () => {
  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  const poll = (p, body) => request(p, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body })
  try {
    const task = (await request(port, '/api/tasks', { method: 'POST', headers: H, body: { title: 'x' } })).json
    const job = (await request(port, `/api/tasks/${task.id}/print`, { method: 'POST', headers: H })).json
    assert.equal((await poll(port, { printer: { ready: true } })).json.jobs.length, 1)
    const sent = (await request(port, `/api/jobs/${job.id}`)).json.job
    assert.equal(sent.status, 'sent')
    assert.equal(sent.requested, job.requested)
    server.close()

    const again = await start(env)
    const port2 = await listen(again)
    assert.deepEqual((await request(port2, `/api/jobs/${job.id}`)).json.job, sent)
    // Inside the 60 s grace: not handed out again.
    assert.deepEqual((await poll(port2, { printer: { ready: true } })).json, { jobs: [] })
    again.close()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('upkeep: stale queued raw jobs expire, sent ones wait, day-old finished jobs leave, snapshot keeps the latest job per task', async () => {
  const { dir, env } = await openBoard()
  const id = Object.fromEntries(['old-task-job', 'task-job-1', 'task-job-2', 'stale-raw', 'stale-sent', 'fresh-raw', 'orphan'].map((n) => [n, randomUUID()]))
  const t = Date.now()
  const hour = 3600_000
  const lines = [
    ev('task.created', { id: 't1', title: 'A', column: 'todo', order: 1 }, t - 30 * hour),
    ev('print.requested', { jobId: id['old-task-job'], kind: 'task', taskId: 't1' }, t - 30 * hour),
    ev('print.finished', { jobId: id['old-task-job'], ok: true }, t - 25 * hour),
    ev('print.requested', { jobId: id['task-job-1'], kind: 'task', taskId: 't1' }, t - 3 * hour),
    ev('print.finished', { jobId: id['task-job-1'], ok: true }, t - 3 * hour),
    ev('print.requested', { jobId: id['task-job-2'], kind: 'task', taskId: 't1' }, t - 2 * hour),
    ev('print.requested', { jobId: id['stale-raw'], kind: 'raw', description: 'old' }, t - 2 * hour),
    // Handed to the agent before the downtime: in its hands, not expired.
    ev('print.requested', { jobId: id['stale-sent'], kind: 'raw', description: 'sent' }, t - 2 * hour),
    ev('print.sent', { jobId: id['stale-sent'] }, t - 2 * hour + 1000),
    // An old log still carrying the payload inline.
    ev('print.requested', { jobId: id['fresh-raw'], kind: 'raw', description: 'new', payload: 'QUJD' }, t - 60_000)
  ]
  await writeFile(env.EVENTS_FILE, lines.join('\n') + '\n')
  await mkdir(join(dir, 'payloads'))
  await writeFile(join(dir, 'payloads', `${id['stale-raw']}.b64`), 'QUJD')
  await writeFile(join(dir, 'payloads', `${id['stale-sent']}.b64`), 'U0VOVA==')
  await writeFile(join(dir, 'payloads', `${id['orphan']}.b64`), 'QUJD')
  await writeFile(join(dir, 'payloads', `${id['orphan']}.b64.0000.tmp`), 'QUJD')
  const server = await start(env)
  const port = await listen(server)
  const job = async (id) => (await request(port, `/api/jobs/${id}`)).json?.job
  try {
    const stale = await job(id['stale-raw'])
    assert.equal(stale.status, 'failed')
    assert.equal(stale.error, 'Expired before the printer was ready')
    assert.equal((await job(id['stale-sent'])).status, 'sent')
    assert.equal((await job(id['task-job-2'])).status, 'queued') // task jobs do not expire
    assert.equal(await job(id['old-task-job']), undefined) // finished over a day ago
    // Expired and orphan payloads and the leftover temp file go; the sent job keeps its bytes.
    await until(async () => (await readdir(join(dir, 'payloads'))).join() === `${id['stale-sent']}.b64`)

    const res = await fetch(`http://localhost:${port}/api/stream`)
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    const snap = JSON.parse(first.slice(first.indexOf('{')))
    assert.deepEqual(snap.jobs.map((j) => j.id).sort(), [id['fresh-raw'], id['stale-raw'], id['stale-sent'], id['task-job-2']].sort())

    // The fresh raw job from the old log still prints from its inline payload; the sent one is resent.
    const poll = (body) => request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true }, ...body } })
    const { jobs } = (await poll()).json
    assert.deepEqual(jobs.find((j) => j.jobId === id['fresh-raw']), { jobId: id['fresh-raw'], raw: 'QUJD' })
    // Past the hour a sent job goes out marked expired: the agent fails it unless it already printed it.
    assert.deepEqual(jobs.find((j) => j.jobId === id['stale-sent']), { jobId: id['stale-sent'], raw: 'U0VOVA==', expired: true })
    await poll({ results: [{ jobId: id['stale-sent'], ok: true }] })
    assert.equal((await job(id['stale-sent'])).status, 'printed')
    // A label that did print after all replaces its expiry; a late failure does not.
    await poll({ results: [{ jobId: id['stale-raw'], ok: false, error: 'jam' }] })
    assert.equal((await job(id['stale-raw'])).error, 'Expired before the printer was ready')
    await poll({ results: [{ jobId: id['stale-raw'], ok: true }] })
    assert.deepEqual([(await job(id['stale-raw'])).status, (await job(id['stale-raw'])).error], ['printed', null])
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('limits: streams per account, agent token guessing, editor keys, non-ASCII return path', async () => {
  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  const base = `http://localhost:${port}`
  const streams = []
  try {
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${base}/api/stream`)
      assert.equal(res.status, 200)
      streams.push(res.body.getReader())
      await streams.at(-1).read()
    }
    assert.equal((await fetch(`${base}/api/stream`)).status, 429)
    await streams.pop().cancel()
    await until(async () => {
      const res = await fetch(`${base}/api/stream`)
      if (res.status !== 200) return false
      streams.push(res.body.getReader())
      return true
    })

    const login = await request(port, '/auth/login?return=%2Fcaf%C3%A9')
    assert.equal(login.status, 302)
    assert.equal(login.headers.location, '/')

    const put = (key, value) => request(port, `/api/editor/cache/${key}`, { method: 'PUT', headers: H, body: { value } })
    assert.equal((await put('Settings', 1)).status, 204)
    assert.equal((await put('settings', 1)).status, 409)
    assert.equal((await put('Settings', 2)).status, 204)
    for (let i = 1; i < 200; i += 1) assert.equal((await put(`k${i}`, i)).status, 204)
    assert.equal((await put('one-too-many', 1)).status, 413)
    assert.equal((await put('k1', null)).status, 204)
    assert.equal((await put('one-too-many', 1)).status, 204)

    const poll = (token) => request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: {} })
    for (let i = 0; i < 20; i += 1) assert.equal((await poll('wrong')).status, 401)
    assert.equal((await poll('wrong')).status, 429)
    assert.equal((await poll('tok')).status, 429)
  } finally {
    for (const reader of streams) await reader.cancel()
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** Just enough of Deployer's data API (rows + query endpoints) for the server's own statements. */
function fakeDeployer() {
  const tables = { kanban_events: [], editor_kv: [], kanban_sessions: [], print_payloads: [] }
  const fake = { tables, queries: [], failNextEventPost: false, seq: 0 }
  fake.server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url, 'http://x')
      const reply = (status, json) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json))
      if (url.pathname.endsWith('/schema')) return reply(200, { sources: [{ source_id: 'src', kind: 'sql' }] })
      if (url.pathname.endsWith('/query')) {
        fake.queries.push(body.query)
        let m
        if (/^CREATE TABLE/.test(body.query)) return reply(200, { results: [{ type: 'empty' }, { type: 'empty' }] })
        if ((m = body.query.match(/^SELECT seq, eid, topic, type, data, ts FROM kanban_events WHERE seq > (\d+) ORDER BY seq LIMIT (\d+)$/))) {
          const cols = ['seq', 'eid', 'topic', 'type', 'data', 'ts']
          const rows = tables.kanban_events.filter((r) => r.seq > Number(m[1])).slice(0, Number(m[2]))
          return reply(200, { results: [{ type: 'rows', columns: cols, rows: rows.map((r) => cols.map((c) => r[c] ?? null)) }] })
        }
        if ((m = body.query.match(/^SELECT seq FROM kanban_events WHERE eid = '([0-9a-f-]{36})'$/))) {
          const rows = tables.kanban_events.filter((r) => r.eid === m[1]).map((r) => [r.seq])
          return reply(200, { results: [{ type: 'rows', columns: ['seq'], rows }] })
        }
        return reply(200, { results: [{ type: 'error', error: { message: `unexpected: ${body.query}` } }] })
      }
      const table = url.pathname.match(/\/tables\/(\w+)\/rows$/)?.[1]
      const rows = tables[table]
      if (!rows) return reply(404, {})
      if (req.method === 'GET') {
        const sorted = [...rows].sort((a, b) => (a.k < b.k ? -1 : 1))
        const offset = Number(url.searchParams.get('offset'))
        return reply(200, { rows: sorted.slice(offset, offset + Number(url.searchParams.get('limit'))) })
      }
      if (req.method === 'POST') {
        if (table === 'kanban_events') {
          if (rows.some((r) => r.eid === body.values.eid)) return reply(400, { detail: 'Duplicate entry (error 1062)' })
          rows.push({ seq: ++fake.seq, ...body.values })
          if (fake.failNextEventPost) {
            fake.failNextEventPost = false
            return reply(502, { detail: 'committed, but the reply was lost' })
          }
        } else rows.push(body.values)
        return reply(200, { row: body.values })
      }
      const i = rows.findIndex((r) => r.k === body.pk.k)
      if (i < 0) return reply(404, { detail: 'Row not found' })
      if (req.method === 'PATCH') Object.assign(rows[i], body.values)
      if (req.method === 'DELETE') rows.splice(i, 1)
      return reply(200, {})
    })
  })
  return fake
}

test('deployer storage: payloads in their own table, append recheck by eid, replay by seq with dedupe', async () => {
  const fake = fakeDeployer()
  const dport = await listen(fake.server)
  const env = { ALLOW_OPEN_BOARD: '1', AGENT_TOKEN: 'tok', DEPLOYER_URL: `http://127.0.0.1:${dport}`, DEPLOYER_API_KEY: 'k', DEPLOYER_PROJECT_ID: 'p' }
  const server = await start(env)
  const port = await listen(server)
  const payload = Buffer.from('PRINT 1\r\n').toString('base64')
  let again
  try {
    assert.match(fake.queries[0], /eid VARCHAR\(36\)[\s\S]*ALTER TABLE kanban_events ADD COLUMN IF NOT EXISTS eid/)
    await request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true } } })
    const queued = await request(port, '/api/editor/print', { method: 'POST', headers: H, body: { payload } })
    assert.equal(queued.status, 202)
    const jobId = queued.json.job.id
    assert.deepEqual(fake.tables.print_payloads.map((r) => [r.k, r.v]), [[jobId, payload]])
    assert.equal(JSON.stringify(fake.tables.kanban_events).includes(payload), false)

    // The insert commits but the reply is lost: the server finds the row by its eid and carries on.
    fake.failNextEventPost = true
    const task = await request(port, '/api/tasks', { method: 'POST', headers: H, body: { title: 'once' } })
    assert.equal(task.status, 201)
    assert.equal(fake.tables.kanban_events.filter((r) => r.type === 'task.created').length, 1)

    assert.equal((await request(port, '/api/editor/cache/a', { method: 'PUT', headers: H, body: { value: { x: 1 } } })).status, 204)
    fake.tables.editor_kv.push({ k: 'bad', v: '{not json', updated: 0 })
    // A row duplicated by an old retry is applied once.
    const dup = fake.tables.kanban_events.find((r) => r.type === 'task.created')
    fake.tables.kanban_events.push({ ...dup, seq: ++fake.seq })
    server.close()

    again = await start(env)
    const port2 = await listen(again)
    assert.equal((await request(port2, `/api/jobs/${jobId}`)).json.job.status, 'queued')
    assert.deepEqual((await request(port2, '/api/editor/cache')).json, { values: { a: { x: 1 } } })
    const poll = await request(port2, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true } } })
    assert.deepEqual(poll.json.jobs.find((j) => j.jobId === jobId), { jobId, raw: payload })
    const res = await fetch(`http://localhost:${port2}/api/stream`)
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    assert.deepEqual(JSON.parse(first.slice(first.indexOf('{'))).tasks.map((t) => t.title), ['once'])
    await request(port2, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true }, results: [{ jobId, ok: true }] } })
    await until(() => fake.tables.print_payloads.length === 0)
  } finally {
    server.close()
    again?.close()
    fake.server.close()
    fake.server.closeAllConnections()
  }
})

test('fold: a repeated print.requested and a print.sent after the finish change nothing', () => {
  const s = emptyState()
  apply(s, { type: 'print.requested', data: { jobId: 'r1', kind: 'raw', description: 'a' }, ts: 1 })
  apply(s, { type: 'print.finished', data: { jobId: 'r1', ok: true }, ts: 2 })
  apply(s, { type: 'print.sent', data: { jobId: 'r1' }, ts: 3 })
  apply(s, { type: 'print.requested', data: { jobId: 'r1', kind: 'raw', description: 'b', payload: 'QUJD' }, ts: 4 })
  assert.deepEqual(s.jobs.get('r1'), { id: 'r1', kind: 'raw', description: 'a', status: 'printed', error: null, requested: 1, ts: 2 })
  assert.equal(s.payloads.has('r1'), false)
})

test('file log: a torn append is cut back, so the next good append survives a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const file = join(dir, 'data', 'events.jsonl')
  const e = (id) => ({ id, topic: 'tasks', type: 'task.created', data: { id }, ts: 1 })
  // Writes part of the line, then fails like ENOSPC; `failCut` also fails the clean-up truncate once.
  let tear = 0
  let failCut = 0
  const io = {
    appendFile: async (path, data, options) => {
      if (tear && tear--) {
        await appendFile(path, data.slice(0, 7), options)
        throw Object.assign(new Error('no space left'), { code: 'ENOSPC' })
      }
      return appendFile(path, data, options)
    },
    truncate: async (path, size) => {
      if (failCut && failCut--) throw Object.assign(new Error('io error'), { code: 'EIO' })
      return truncate(path, size)
    }
  }
  try {
    const store = fileStore(file, io)
    assert.deepEqual(await store.load(), [])
    await store.append(e('a'))
    tear = 1
    await assert.rejects(store.append(e('lost1')), /no space/)
    await store.append(e('b'))
    // The clean-up fails too: the fragment stays until the next append cuts it first.
    tear = 1
    failCut = 1
    await assert.rejects(store.append(e('lost2')), /no space/)
    assert.match(await readFile(file, 'utf8'), /\{"id":"$/)
    await store.append(e('c'))
    assert.deepEqual((await fileStore(file).load()).map((x) => x.id), ['a', 'b', 'c'])
    // Owner-only modes.
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal((await stat(join(dir, 'data'))).mode & 0o777, 0o700)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** A signed-in deployment with a stand-in token endpoint answering `status`. */
async function googleBoard(status = 500) {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const google = http.createServer((req, res) => req.resume().on('end', () => res.writeHead(status).end('{}')))
  const env = {
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csecret',
    ALLOWED_EMAILS: 'me@example.com',
    SESSION_SECRET: SECRET,
    AGENT_TOKEN: 'a'.repeat(32),
    EVENTS_FILE: join(dir, 'events.jsonl')
  }
  const hooks = { tokenUrl: `http://127.0.0.1:${await listen(google)}/token` }
  const server = await start(env, hooks)
  const port = await listen(server)
  const close = async () => {
    server.close()
    google.close()
    await rm(dir, { recursive: true, force: true })
  }
  return { dir, env, hooks, server, port, close }
}

test('lockout: cookieless or cancelled callbacks are not guesses; sign-in and agent count apart', async () => {
  const b = await googleBoard(500)
  const poll = (token) => request(b.port, '/api/agent/poll', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: {} })
  try {
    // What any web page can make a browser load (img tags): no cookie, a made-up state, a Google error.
    for (let i = 0; i < 25; i += 1) {
      assert.equal((await request(b.port, '/auth/callback?state=x')).status, 400)
      assert.equal((await request(b.port, '/auth/callback?state=x&error=access_denied')).status, 400)
    }
    assert.equal((await poll('a'.repeat(32))).status, 200)

    // What any web page can post cross-site without a preflight: no Authorization header.
    for (let i = 0; i < 25; i += 1) assert.equal((await request(b.port, '/api/agent/poll', { method: 'POST', body: {} })).status, 401)
    assert.equal((await poll('a'.repeat(32))).status, 200)

    // A real attempt whose code exchange fails does count, and only toward sign-in.
    const login = await request(b.port, '/auth/login')
    const oauth = cookieOf(login, 'oauth')
    const state = new URL(login.headers.location).searchParams.get('state')
    const exchange = () => request(b.port, `/auth/callback?code=c&state=${state}`, { headers: { cookie: oauth } })
    for (let i = 0; i < 20; i += 1) assert.equal((await exchange()).status, 400)
    assert.equal((await exchange()).status, 429)
    assert.equal((await poll('a'.repeat(32))).status, 200)

    // Agent guesses lock out the agent route, not sign-in.
    for (let i = 0; i < 20; i += 1) assert.equal((await poll('wrong')).status, 401)
    assert.equal((await poll('a'.repeat(32))).status, 429)
  } finally {
    await b.close()
  }
  const c = await googleBoard(500)
  try {
    for (let i = 0; i < 20; i += 1) await request(c.port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: {} })
    const login = await request(c.port, '/auth/login')
    const state = new URL(login.headers.location).searchParams.get('state')
    assert.equal((await request(c.port, `/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, 'oauth') } })).status, 400)
  } finally {
    await c.close()
  }
})

test('sessions: a renew never brings back a logged-out or deleted session', async () => {
  const b = await googleBoard(500)
  const sid = Buffer.alloc(32, 7).toString('base64url')
  const sid2 = Buffer.alloc(32, 8).toString('base64url')
  const hash = (id) => createHash('sha256').update(id).digest('hex')
  const dir = join(b.dir, 'sessions')
  const h = { 'X-Requested-With': 'kanban' }
  b.server.close()
  try {
    // Less than half the life left: the next request renews.
    await mkdir(dir, { recursive: true })
    for (const id of [sid, sid2]) await writeFile(join(dir, `${hash(id)}.json`), JSON.stringify({ email: 'me@example.com', exp: Date.now() + 3600_000 }))
    const server = await start(b.env, b.hooks)
    const port = await listen(server)
    try {
      // Renew and logout race: the logout lands last.
      const me = await request(port, '/api/me', { headers: { cookie: `sid=${sid}` } })
      assert.equal(me.status, 200)
      assert.ok(cookieOf(me, 'sid'))
      assert.equal((await request(port, '/auth/logout', { method: 'POST', headers: { ...h, cookie: `sid=${sid}` } })).status, 204)
      await new Promise((r) => setTimeout(r, 50))
      // A row deleted under a live session is not re-inserted by its renew.
      await rm(join(dir, `${hash(sid2)}.json`))
      assert.equal((await request(port, '/api/me', { headers: { cookie: `sid=${sid2}` } })).status, 200)
      await new Promise((r) => setTimeout(r, 50))
      assert.deepEqual(await readdir(dir), [])
    } finally {
      server.close()
    }
    const again = await start(b.env, b.hooks)
    const port2 = await listen(again)
    assert.equal((await request(port2, '/api/me', { headers: { cookie: `sid=${sid}` } })).status, 401)
    again.close()
  } finally {
    await b.close()
  }
})

test('quota: parallel editor writes cannot overshoot 64 MB; at most 50 raw labels wait', async () => {
  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  const poll = (body = {}) => request(port, '/api/agent/poll', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: { printer: { ready: true }, ...body } })
  try {
    const value = 'x'.repeat(7_000_000)
    const puts = await Promise.all(Array.from({ length: 10 }, (_, i) => request(port, `/api/editor/cache/big${i}`, { method: 'PUT', headers: H, body: { value } })))
    assert.deepEqual(puts.map((r) => r.status).sort(), [...Array(9).fill(204), 413])

    await poll()
    const payload = Buffer.from('PRINT 1\r\n').toString('base64')
    const print = () => request(port, '/api/editor/print', { method: 'POST', headers: H, body: { payload } })
    const all = await Promise.all(Array.from({ length: 51 }, print))
    assert.deepEqual(all.map((r) => r.status).sort(), [...Array(50).fill(202), 503])
    assert.match(all.find((r) => r.status === 503).json.error, /50 labels are already waiting/)
    const payloads = join(dir, 'payloads')
    assert.equal((await stat(payloads)).mode & 0o777, 0o700)
    assert.equal((await stat(join(payloads, (await readdir(payloads))[0]))).mode & 0o777, 0o600)
    // Once one prints, there is room again.
    const { jobs } = (await poll()).json
    await poll({ results: [{ jobId: jobs[0].jobId, ok: true }] })
    assert.equal((await print()).status, 202)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('streams: only the board itself may open one (Lax cookies also come from sibling subdomains)', async () => {
  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  try {
    assert.equal((await request(port, '/api/stream', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403)
    assert.equal((await request(port, '/api/stream', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('task prints: one waiting label per task; a print racing its task deletion leaves nothing behind', async () => {
  const state = apply(apply(emptyState(), { type: 'task.deleted', data: { id: 't1' }, ts: 1 }), {
    type: 'print.requested', data: { jobId: 'j1', kind: 'task', taskId: 't1' }, ts: 2
  })
  assert.equal(state.jobs.size, 0)

  const { dir, env } = await openBoard()
  const server = await start(env)
  const port = await listen(server)
  try {
    const task = await request(port, '/api/tasks', { method: 'POST', headers: H, body: { title: 'once' } })
    const first = await request(port, `/api/tasks/${task.json.id}/print`, { method: 'POST', headers: H })
    const again = await request(port, `/api/tasks/${task.json.id}/print`, { method: 'POST', headers: H })
    assert.equal(first.status, 202)
    assert.equal(again.status, 200)
    assert.equal(again.json.id, first.json.id)
    // Presses at the same moment (two tabs) still make one label.
    const other = await request(port, '/api/tasks', { method: 'POST', headers: H, body: { title: 'race' } })
    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => request(port, `/api/tasks/${other.json.id}/print`, { method: 'POST', headers: H })))
    assert.equal(new Set(burst.map((r) => r.json.id)).size, 1)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
