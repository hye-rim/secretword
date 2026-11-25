'use strict';

// 서버 시험: 보안·안정성 + 온라인 대전 흐름(숨긴 단어 감추기, 힌트 규칙, 점수, 제한 시간, 재접속)
// 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');

// 운영체제가 지금 비어 있는 포트를 골라 준다
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = 1500; // 시험용 제한 시간(모든 단계)
const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), SECRET_MS: String(T), HINT_MS: String(T), GUESS_MS: String(T), NEXT_MS: String(T) }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 100; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], rejects: [], suggestion: null, closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
    if (m.t === 'reject') c.rejects.push(m);
    if (m.t === 'suggestion') c.suggestion = m;
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
const roles = (a, b) => (a.room.turn.iSet ? [a, b] : [b, a]);   // [출제자, 맞히는 쪽]
// 출제자가 추천 힌트를 받아 낸다 (하나)
async function giveHint(setter, guesser) {
  const n = setter.room.turn.hints.length;
  setter.suggestion = null; send(setter, 'suggest');
  assert.ok(await until(() => setter.suggestion), 'suggestion arrives');
  send(setter, 'hint', { w: setter.suggestion.w });
  assert.ok(await until(() => setter.room.turn.hints.length > n && guesser.room.turn.hints.length > n), 'hint reaches both');
}
// 95% 이상 힌트가 나올 때까지
async function hintUntilGuess(setter, guesser) {
  for (let k = 0; k < 12 && guesser.room.turn.phase === 'hint'; k++) await giveHint(setter, guesser);
  assert.ok(await until(() => guesser.room.turn.phase === 'guess'), 'guessing opens after a 95 hint');
}
async function guessWord(guesser, w) {
  const n = guesser.room.turn.guesses.length;
  send(guesser, 'guess', { w });
  assert.ok(await until(() => guesser.room.turn.guesses.length > n || guesser.room.turn.done), 'guess accepted');
}
const WRONG = ['우주', '전쟁', '선거', '축구', '병원', '음악'];

test('malformed URLs get 400, data files are served, dotfiles are not', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/data/vecs.bin'), 200);
  assert.strictEqual(await get('/data/words.txt'), 200);
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(400);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match: the setter gets five own options, the guesser sees no secret', async () => {
  await ready;
  const [a, b] = await pair();
  assert.strictEqual(a.room.code, b.room.code);
  assert.notStrictEqual(a.room.turn.iSet, b.room.turn.iSet);
  const [s, q] = roles(a, b);
  assert.strictEqual(s.room.turn.phase, 'secret');
  assert.strictEqual(s.room.turn.options.length, 5);
  assert.strictEqual(q.room.turn.options, null);
  assert.deepStrictEqual(s.room.pieces, { me: 2, opp: 2 });
  send(q, 'secret', { k: 0 });                                    // 맞히는 쪽은 못 고른다
  for (const bad of [-1, 5, 'x', 1.5, null]) send(s, 'secret', { k: bad });
  await sleep(150);
  assert.strictEqual(s.room.turn.phase, 'secret', 'garbage choices are ignored');
  const word = s.room.turn.options[2];
  send(s, 'secret', { k: 2 });
  assert.ok(await until(() => s.room.turn.phase === 'hint' && q.room.turn.phase === 'hint'));
  assert.strictEqual(s.room.turn.secret, word);
  assert.strictEqual(q.room.turn.secret, null);
  assert.ok(!q.msgs.some((m) => m.t === 'room' && m.turn && (m.turn.secret || (m.turn.options || []).length)), 'the guesser never receives the secret or the options');
  a.ws.close(); b.ws.close();
});

test('hints continue until one reaches 95, rule breaks are rejected privately', async () => {
  await ready;
  const [a, b] = await pair();
  const [s, q] = roles(a, b);
  send(s, 'secret', { k: 0 }); await until(() => s.room.turn.phase === 'hint');
  send(q, 'hint', { w: '사과' });
  send(s, 'hint', { w: s.room.turn.secret });
  send(s, 'hint', { w: '없는낱말이에요' });
  send(s, 'hint', { w: 12 });
  assert.ok(await until(() => s.rejects.length >= 2));
  assert.deepStrictEqual(s.rejects.map((r) => r.err).slice(0, 2), ['secret', 'unknown']);
  assert.strictEqual(q.rejects.length, 0);
  assert.strictEqual(s.room.turn.hints.length, 0);
  send(q, 'guess', { w: '사과' }); await sleep(100);
  assert.strictEqual(q.room.turn.guesses.length, 0, 'no guessing before a 95 hint');
  await hintUntilGuess(s, q);
  const hs = q.room.turn.hints;
  assert.ok(hs[hs.length - 1].sim >= 95 && hs.slice(0, -1).every((h) => h.sim < 95));
  a.ws.close(); b.ws.close();
});

test('answers show only right or wrong; piece, pass and stage points; a correct answer scores 1', async () => {
  await ready;
  const [a, b] = await pair();
  const [s, q] = roles(a, b);
  send(s, 'secret', { k: 1 }); await until(() => s.room.turn.phase === 'hint');
  const secret = s.room.turn.secret;
  await hintUntilGuess(s, q);
  send(s, 'guess', { w: secret }); await sleep(100);
  assert.strictEqual(q.room.turn.guesses.length, 0, 'the setter cannot answer');
  const wrong = WRONG.filter((w) => w !== secret && !q.room.turn.hints.some((h) => h.word === w));
  await guessWord(q, wrong[0]);
  const g0 = q.room.turn.guesses[0];
  assert.deepStrictEqual(Object.keys(g0).sort(), ['correct', 'stage', 'word'], 'no similarity for an answer');
  assert.ok(await until(() => q.room.turn.phase === 'extra'));
  send(q, 'piece');
  assert.ok(await until(() => q.room.turn.phase === 'guess' && q.room.pieces.me === 1));
  await guessWord(q, wrong[1]);
  assert.ok(await until(() => q.room.turn.stage === 2 && q.room.turn.phase === 'hint'), 'stage 2 after two wrong answers');
  assert.deepStrictEqual(s.room.score, { me: 1, opp: 0 }, 'setter gets 1 for stage 1');
  await hintUntilGuess(s, q);
  await guessWord(q, wrong[2]);
  assert.ok(await until(() => q.room.turn.phase === 'extra'));
  send(q, 'pass');
  assert.ok(await until(() => q.room.turn.stage === 3));
  assert.deepStrictEqual(s.room.score, { me: 3, opp: 0 });
  await hintUntilGuess(s, q);
  await guessWord(q, secret);
  assert.ok(await until(() => q.room.turn.done && s.room.turn.done));
  assert.strictEqual(q.room.turn.secret, secret, 'revealed after the turn');
  assert.deepStrictEqual(q.room.score, { me: 1, opp: 3 });
  send(q, 'next'); await sleep(100);
  assert.ok(q.room.turn.done, 'one next is not enough');
  send(s, 'next');
  assert.ok(await until(() => !q.room.turn.done && q.room.turn.iSet && !s.room.turn.iSet), 'roles swap for the next turn');
  assert.strictEqual(q.room.turn.options.length, 5);
  a.ws.close(); b.ws.close();
});

test('when nobody acts, timers end every stage and the setter scores 1+2+3', async () => {
  await ready;
  const [a, b] = await pair();
  const [s, q] = roles(a, b);
  assert.ok(await until(() => s.room.turn.done, 10 * T), 'the turn finishes on timers alone');
  assert.strictEqual(s.room.turn.hints.length, 3, 'one 95 hint per stage was filled');
  assert.ok(s.room.turn.hints.every((h) => h.sim >= 95));
  assert.deepStrictEqual(s.room.score, { me: 6, opp: 0 });
  assert.ok(await until(() => !s.room.turn.done && q.room.turn.iSet, 2 * T + 500), 'next turn starts by itself');
  a.ws.close(); b.ws.close();
});

test('leaving mid-game gives the win to the other side and rematch needs both', async () => {
  await ready;
  const [a, b] = await pair();
  send(a, 'leave');
  assert.ok(await until(() => b.room.state === 'over'));
  await sleep(100);
  assert.strictEqual(a.room.state, 'playing', 'the leaver is not sent the result');
  assert.strictEqual(b.room.reason, 'left');
  assert.strictEqual(b.room.winner, 'me');
  send(b, 'rematch'); await sleep(150);
  assert.strictEqual(b.room.state, 'over', 'no rematch without an opponent');
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, iSet = a.room.turn.iSet;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.state === 'playing' && a2.room.turn.iSet === iSet));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 맨 뒤에 둔다
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(400);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)));
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)));
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
