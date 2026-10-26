import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, cleanAgentReport, createBroker, emptyState, start, validTask } from './server.mjs'

test('fold: create, move, print, finish, delete', () => {
  const s = emptyState()
  apply(s, { type: 'task.created', data: { id: 't1', title: 'A', column: 'todo', order: 1 }, ts: 1 })
  apply(s, { type: 'task.updated', data: { id: 't1', column: 'doing' }, ts: 2 })
  apply(s, { type: 'print.requested', data: { jobId: 'j1', taskId: 't1' }, ts: 3 })
  apply(s, { type: 'print.finished', data: { jobId: 'j1', ok: false, error: 'jam' }, ts: 4 })
  assert.equal(s.tasks.get('t1').column, 'doing')
  assert.equal(s.tasks.get('t1').updated, 2)
  assert.deepEqual(s.jobs.get('j1'), { id: 'j1', taskId: 't1', status: 'failed', error: 'jam', ts: 4 })
  apply(s, { type: 'task.deleted', data: { id: 't1' }, ts: 5 })
  assert.equal(s.tasks.size, 0)
  assert.equal(s.jobs.size, 0)
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

test('http: auth, task lifecycle, agent pull subscription', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kanban-'))
  const server = await start({ BOARD_KEY: 'secret', AGENT_TOKEN: 'tok', EVENTS_FILE: join(dir, 'events.jsonl') })
  await new Promise((r) => server.listen(0, r))
  const base = `http://localhost:${server.address().port}`
  const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' }
  try {
    assert.equal((await fetch(`${base}/api/me`)).status, 401)
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: h, body: '{"key":"nope"}' })).status, 401)
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', body: '{"key":"secret"}' })).status, 403)
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: h, body: '{"key":"secret"}' })
    assert.equal(login.status, 204)
    const auth = { ...h, cookie: login.headers.get('set-cookie').split(';')[0] }

    const task = await (await fetch(`${base}/api/tasks`, { method: 'POST', headers: auth, body: '{"title":"Label run"}' })).json()
    assert.equal(task.column, 'todo')
    const job = await (await fetch(`${base}/api/tasks/${task.id}/print`, { method: 'POST', headers: auth })).json()
    assert.equal(job.status, 'queued')

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
    const again = await start({ ALLOW_OPEN_BOARD: '1', EVENTS_FILE: join(dir, 'events.jsonl') })
    await new Promise((r) => again.listen(0, r))
    const res = await fetch(`http://localhost:${again.address().port}/api/stream`)
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
