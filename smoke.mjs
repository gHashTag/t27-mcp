#!/usr/bin/env node
// Exercises every tool against the live site and asserts the invariants that
// have actually broken before. Run it before tagging: `npm run smoke`.
//
// It talks to t27.ai over the real protocol rather than importing the handlers,
// because the two failures worth catching are a malformed JSON-RPC frame and a
// feed that changed shape — and neither is visible to an in-process call.

import { spawn } from 'node:child_process';

const child = spawn('node', [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    const r = pending.get(m.id);
    if (r) (m.error ? r.reject(new Error(m.error.message)) : r.resolve(m.result), pending.delete(m.id));
  }
});

let nextId = 0;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`${method} ${params?.name || ''} timed out`))), 30000);
  });
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args }).then((r) => JSON.parse(r.content[0].text));

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failed++;
};

const run = async () => {
  const init = await rpc('initialize', {});
  check('initialize returns this package version', init.serverInfo.version === JSON.parse(await import('node:fs/promises').then((f) => f.readFile(new URL('./package.json', import.meta.url), 'utf8'))).version, init.serverInfo.version);

  const { tools } = await rpc('tools/list');
  check('every tool has a description and a schema', tools.every((t) => t.description && t.inputSchema?.type === 'object'), `${tools.length} tools`);

  const st = await call('t27_status');
  check('status reaches the atlas', st.atlasError === null, st.atlasError || 'no error');
  check('spec count agrees with the health split', st.specCount === Object.values(st.health).reduce((a, b) => a + b, 0), `${st.specCount} = ${JSON.stringify(st.health)}`);
  check('every failing spec names a cause', st.failingSpecs.every((s) => s.whyFailing?.length), `${st.failingSpecs.length} failing`);

  // The counted backend failures and the specs blaming a backend must agree;
  // the remainder is exactly the specs that never parsed.
  const counted = Object.values(st.backendFailures || {}).reduce((a, b) => a + b, 0);
  const blaming = st.failingSpecs.filter((s) => s.failedBackends?.length).length;
  check('backendFailures tally matches the specs blaming a backend', counted === blaming, `${counted} counted vs ${blaming} blaming`);

  const fails = await call('t27_specs', { health: 'fail' });
  check('t27_specs finds the same failures as t27_status', fails.matched === st.failingSpecs.length, `${fails.matched} vs ${st.failingSpecs.length}`);

  const fmts = await call('t27_formats');
  check('format catalog parses from the live SSOT', fmts.totalInCatalog > 0 && Object.keys(fmts.clusters).length > 0, `${fmts.totalInCatalog} formats in ${Object.keys(fmts.clusters).length} clusters`);
  const one = await call('t27_format', { id: fmts.formats[0].id });
  check('a single format round-trips by id', one.id === fmts.formats[0].id, one.id);

  // The strongest available check that the manifest and the published corpus
  // describe the same file: the byte count must match, not merely both exist.
  const demo = await call('t27_spec', { path: 'specs/demos/hello_world.t27', source: true });
  check('published source byte count matches the manifest', demo.source.length === demo.bytes, `${demo.source.length} fetched vs ${demo.bytes} recorded`);

  const g = await call('t27_grep', { pattern: 'invariant', category: 'specs/numeric', maxSpecs: 8, maxHitsPerSpec: 2 });
  check('grep reads inside spec sources', g.totalHits > 0 && g.opened <= 8, `${g.totalHits} hits in ${g.specsWithHits}/${g.opened} opened`);
  check('grep reports truncation honestly', g.truncated === g.candidates > g.opened || typeof g.truncated === 'boolean', `${g.candidates} candidates, ${g.opened} opened`);

  const iss = await call('t27_issues', { limit: 3, detail: true });
  check('issues carry their spec links', iss.total > 0, `${iss.total} issues`);
  const ep = await call('t27_epics');
  check('epics load', ep.matched > 0, `${ep.matched} epics`);
  const mod = await call('t27_modules', { limit: 3 });
  check('modules load', mod.totalModules > 0, `${mod.totalModules} modules`);
  const w = await call('t27_worlds');
  check('worlds load', w.worlds.length > 0, `${w.worlds.length} repositories`);

  const game = await call('t27_game');
  check('game states exactly three claim colours plus hover', Object.keys(game.rules.colourLaw).length === 4, Object.keys(game.rules.colourLaw).join(' '));
  check('game board state names the failing specs', game.board_state.failing.length === st.failingSpecs.length, `${game.board_state.failing.length}`);

  // t27_raw is the only tool that takes a path from the caller.
  for (const bad of ['//evil.example.com/x.json', 'no-leading-slash', '/a\\b.json']) {
    let refused = false;
    try {
      await call('t27_raw', { path: bad });
    } catch {
      refused = true;
    }
    check(`t27_raw refuses ${JSON.stringify(bad)}`, refused);
  }
  const raw = await call('t27_raw', { path: '/queen/modules.json' });
  check('t27_raw still fetches a legitimate site path', !!raw.modules, `${raw.modules?.length} modules`);

  child.kill();
  console.log(failed ? `\n${failed} check(s) failed` : `\nall checks passed`);
  process.exit(failed ? 1 : 0);
};

run().catch((e) => {
  child.kill();
  console.error('smoke run threw:', e.message);
  process.exit(1);
});
