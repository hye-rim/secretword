'use strict';

// 숨은 단어 서버: 정적 파일 + 친구와 온라인 대전(WebSocket). 컴퓨터 대전은 브라우저에서만 돈다.
// 온라인에서는 숨긴 단어가 상대 브라우저로 가면 안 되므로 유사도·순위 계산과 규칙 판정을 모두 서버가 한다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const L = require('./public/logic.js');

// ---------- Config ----------
const PORT = process.env.PORT || 3029;
// 제한 시간(시험에서는 환경변수로 줄인다)
const SECRET_MS = Number(process.env.SECRET_MS) || 30000;   // 숨길 단어 고르기. 넘기면 첫 후보로
const HINT_MS = Number(process.env.HINT_MS) || 180000;      // 한 단계 힌트(95% 이상이 나올 때까지). 넘기면 서버가 95% 이상 힌트로 끝낸다
const GUESS_MS = Number(process.env.GUESS_MS) || 60000;     // 한 단계 답(피스 포함). 넘기면 못 맞힌 것으로
const NEXT_MS = Number(process.env.NEXT_MS) || 12000;       // 차례 결과를 보는 시간. 둘 다 다음을 누르면 바로 넘어간다
const GRACE_MS = 30000;         // 대국 중 연결이 끊겨도 이 시간 안에 돌아오면 이어서 한다
const HEARTBEAT_MS = 25000;
const SILENCE_TIMEOUT_MS = 90000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- 단어 자료 ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const E = L.makeEngine(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'words.txt'), 'utf8'), new Int8Array(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'vecs.bin'))));

// ---------- Static file server ----------
function safeDecode(s) {
  try {
    const d = decodeURIComponent(s);
    return d.includes('\0') ? null : d;
  } catch { return null; }
}
function isServable(filePath, baseDir) {
  const inside = filePath === baseDir || filePath.startsWith(baseDir + path.sep);
  return inside && !filePath.slice(baseDir.length).split(path.sep).some((seg) => seg.startsWith('.'));
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let reqPath = safeDecode(req.url.split('?')[0]);
  if (reqPath === null) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bad request'); return; }
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!isServable(filePath, PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.bin' || ext === '.txt' ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  });
});

// 메시지 크기 제한: 이 게임의 메시지는 모두 짧다
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// ---------- 방 코드 무차별 대입 방지 ----------
const JOIN_FAIL_MAX = 8, JOIN_WINDOW_MS = 60000, JOIN_BLOCK_MS = 60000;
const joinFails = new Map();
const clientIp = (req) => String((req && req.headers['x-forwarded-for']) || (req && req.socket.remoteAddress) || '').split(',')[0].trim();
function joinBlocked(ip) { const f = joinFails.get(ip); return !!f && f.until > Date.now(); }
function noteJoinFail(ip) {
  const now = Date.now();
  let f = joinFails.get(ip);
  if (!f || now - f.since > JOIN_WINDOW_MS) f = { n: 0, since: now, until: 0 };
  f.n++;
  if (f.n >= JOIN_FAIL_MAX) { f.until = now + JOIN_BLOCK_MS; f.n = 0; f.since = now; }
  joinFails.set(ip, f);
  if (joinFails.size > 2000) for (const [k, v] of joinFails) if (v.until < now && now - v.since > JOIN_WINDOW_MS) joinFails.delete(k);
}

// ---------- State ----------
const rooms = new Map();
const clients = new Map();
let queue = null;
let nextId = 1;

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ t: type, ...payload }));
}
function makeCode() {
  for (let k = 0; k < 50; k++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return 'R' + Date.now().toString(36).slice(-3).toUpperCase();
}
const makeToken = () => crypto.randomBytes(18).toString('base64url');
function sanitizeName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  return name || `손님${Math.floor(100 + Math.random() * 900)}`;
}
const otherSide = (s) => (s === 'you' ? 'cpu' : 'you');
// 단어 입력: 문자열만, 짧게
const wordArg = (w) => (typeof w === 'string' && w.length <= 20 ? w : null);

// ---------- Rooms ----------
function createRoom(isPrivate) {
  const room = {
    code: makeCode(), isPrivate,
    seats: [],               // { client, name, side('you'|'cpu': 규칙 코드의 이름. 'cpu' 가 각 라운드에 먼저 출제), token, online, graceTimer }
    g: null,
    state: 'waiting',        // waiting | playing | over
    reason: '',              // finish | left
    winner: null,            // 'you' | 'cpu' | null(무승부)
    deadline: 0, timer: null,
    nextReady: new Set(),    // 차례 결과를 보고 다음을 누른 쪽
    rematch: new Set(),
    games: 0,
  };
  rooms.set(room.code, room);
  return room;
}
const seatOf = (room, client) => room.seats.find((s) => s.client === client);
const seatBySide = (room, side) => room.seats.find((s) => s.side === side);

function arm(room, ms, fn) {
  clearTimeout(room.timer);
  room.deadline = Date.now() + ms;
  room.timer = setTimeout(() => { room.timer = null; if (room.state === 'playing') { fn(); pushRoom(room); } }, ms);
}

function snapshot(room, seat) {
  const me = seat.side, g = room.g, t = g && g.t;
  let turn = null;
  if (t) {
    const iSet = t.setter === me;
    turn = {
      round: t.round, iSet, stage: t.stage, phase: t.phase, done: t.done, solved: t.solved, pts: t.pts,
      hints: t.hints.map((h) => ({ word: h.word, sim: Math.round(h.sim * 100) / 100, stage: h.stage })),
      guesses: t.guesses.map((h) => ({ word: h.word, stage: h.stage, correct: h.correct })), // 답은 맞음·틀림만
      // 숨긴 단어는 출제자에게만, 차례가 끝나면 둘 다에게. 후보 단어는 고를 때 출제자에게만
      secret: t.secret >= 0 && (iSet || t.done) ? E.words[t.secret] : null,
      options: iSet && t.phase === 'secret' ? g.deck[me].map((i) => E.words[i]) : null,
      last: g.ti + 1 >= g.order.length,
      nextReady: room.nextReady.has(me),
    };
  }
  return {
    code: room.code, isPrivate: room.isPrivate, token: seat.token,
    players: room.seats.map((s) => ({ name: s.name, me: s === seat, online: s.online })),
    state: room.state, reason: room.reason,
    winner: room.state === 'over' ? (room.winner === null ? 'draw' : room.winner === me ? 'me' : 'opp') : null,
    score: g ? { me: g.score[me], opp: g.score[otherSide(me)] } : { me: 0, opp: 0 },
    pieces: g ? { me: g.pieces[me], opp: g.pieces[otherSide(me)] } : { me: 0, opp: 0 },
    turn,
    history: g ? g.history.map((h) => ({ round: h.round, iSet: h.setter === me, word: h.word, solved: h.solved, stage: h.stage, pts: h.pts })) : [],
    remain: room.state === 'playing' && room.timer ? Math.max(0, room.deadline - Date.now()) : 0,
    rematch: room.rematch.size, iRematch: room.rematch.has(me),
  };
}
function pushRoom(room) {
  for (const s of room.seats) if (s.online && s.client) send(s.client.ws, 'room', snapshot(room, s));
}

function sitDown(room, client) {
  const seat = { client, name: client.name, side: null, token: makeToken(), online: true, graceTimer: null };
  room.seats.push(seat);
  client.roomCode = room.code;
  if (room.seats.length === 2) startGame(room, true);
  else pushRoom(room);
}

function startGame(room, first) {
  // 첫 판은 무작위, 한 판 더부터는 먼저 출제하는 쪽을 바꾼다
  if (first) { const b = crypto.randomInt(2); room.seats[b].side = 'cpu'; room.seats[1 - b].side = 'you'; }
  else for (const s of room.seats) s.side = otherSide(s.side);
  room.g = L.newGame(E, { seed: crypto.randomInt(1, 2 ** 31), level: 'normal', rounds: 2 });
  room.state = 'playing'; room.reason = ''; room.winner = null;
  room.rematch.clear(); room.games++;
  beginTurn(room);
  pushRoom(room);
}

function beginTurn(room) {
  room.nextReady.clear();
  arm(room, SECRET_MS, () => chooseSecret(room, 0));
}
function chooseSecret(room, k) {
  const g = room.g, t = g.t, d = g.deck[t.setter];
  if (k >= 0 && k < d.length && L.setSecret(g, t.setter, d[k]).ok) armHints(room);
}
function armHints(room) { arm(room, HINT_MS, () => autoHints(room)); }
// 시간 안에 95% 이상 힌트를 못 내면 서버가 95% 이상 힌트를 내서 단계를 끝낸다
function autoHints(room) {
  const g = room.g, t = g.t;
  let guard = 0;
  while (t.phase === 'hint' && guard++ < 20) { const h = L.cpuHint(g, { finish: true }); if (h < 0 || !L.addHint(g, t.setter, h).ok) break; }
  if (t.phase === 'guess') armGuess(room);
}
function armGuess(room) { arm(room, GUESS_MS, () => forfeit(room)); }
function forfeit(room) {
  const r = L.forfeitGuesses(room.g);
  if (r.nextStage) armHints(room);
  else if (r.turnOver) turnDone(room);
}
// 답·피스 결과에 따라 다음 일정
function afterGuess(room, r) {
  if (r.turnOver) turnDone(room);
  else if (r.nextStage) armHints(room);
}
function turnDone(room) {
  room.nextReady.clear();
  arm(room, NEXT_MS, () => advance(room));
}
function advance(room) {
  const g = room.g;
  if (!g.t || !g.t.done) return;
  L.nextTurn(g);
  if (g.over) return finish(room, 'finish', L.winner(g));
  beginTurn(room);
}
function finish(room, reason, winner) {
  if (room.state !== 'playing') return;
  clearTimeout(room.timer); room.timer = null;
  room.state = 'over'; room.reason = reason; room.winner = winner;
  pushRoom(room);
}

function closeRoom(room) {
  clearTimeout(room.timer);
  for (const s of room.seats) { clearTimeout(s.graceTimer); if (s.client) s.client.roomCode = null; }
  rooms.delete(room.code);
}
function vacate(room, seat) {
  clearTimeout(seat.graceTimer);
  seat.online = false;     // 나간 사람에게는 결과를 보내지 않는다(이미 다른 화면으로 갔다)
  if (room.state === 'playing') finish(room, 'left', otherSide(seat.side));
  room.seats = room.seats.filter((s) => s !== seat);
  if (seat.client) seat.client.roomCode = null;
  if (!room.seats.length || room.state === 'waiting') { closeRoom(room); return; }
  room.rematch.clear();
  pushRoom(room);
}
const dropFromQueue = (client) => { if (queue === client) queue = null; };

// 지금 게임 중인 자리와 그 차례
function current(client) {
  const room = rooms.get(client.roomCode);
  const seat = room && seatOf(room, client);
  if (!seat || room.state !== 'playing' || !room.g || !room.g.t) return null;
  return { room, seat, g: room.g, t: room.g.t };
}

// ---------- Handlers ----------
const handlers = {
  hello(client, msg) { client.name = sanitizeName(msg.name); },

  quick(client) {
    if (client.roomCode) return;
    if (queue && queue !== client && queue.ws.readyState === queue.ws.OPEN) {
      const other = queue; queue = null;
      const room = createRoom(false);
      sitDown(room, other); sitDown(room, client);
    } else { queue = client; send(client.ws, 'queued'); }
  },
  create(client) {
    if (client.roomCode) return;
    dropFromQueue(client);
    sitDown(createRoom(true), client);
  },
  join(client, msg) {
    if (client.roomCode) return;
    dropFromQueue(client);
    if (joinBlocked(client.ip)) return send(client.ws, 'error', { msg: '방 코드를 너무 많이 틀렸어요. 1분 뒤에 다시 해 주세요.' });
    const room = rooms.get(String(msg.code || '').trim().toUpperCase());
    if (!room) { noteJoinFail(client.ip); return send(client.ws, 'error', { msg: '그런 방이 없어요. 코드를 확인해 주세요.' }); }
    if (room.seats.length >= 2) return send(client.ws, 'error', { msg: '이미 두 사람이 하고 있는 방이에요.' });
    sitDown(room, client);
  },
  resume(client, msg) {
    const room = rooms.get(String(msg.code || ''));
    const seat = room && room.seats.find((s) => s.token === msg.token);
    if (!seat) return send(client.ws, 'resumeFailed');
    if (seat.client && seat.client !== client && seat.client.ws.readyState === seat.client.ws.OPEN) {
      seat.client.roomCode = null;
      send(seat.client.ws, 'error', { msg: '다른 창에서 이 대전에 다시 들어왔어요.' });
    }
    clearTimeout(seat.graceTimer);
    seat.client = client; seat.online = true;
    client.name = seat.name; client.roomCode = room.code;
    pushRoom(room);
  },
  cancel(client) {
    dropFromQueue(client);
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (seat && room.state === 'waiting') vacate(room, seat);
  },

  // 숨길 단어: 내 후보 중 k 번째
  secret(client, msg) {
    const c = current(client);
    if (!c || c.t.setter !== c.seat.side || c.t.phase !== 'secret') return;
    if (!Number.isInteger(msg.k) || msg.k < 0 || msg.k >= c.g.deck[c.seat.side].length) return;
    chooseSecret(c.room, msg.k); pushRoom(c.room);
  },
  hint(client, msg) {
    const c = current(client), w = wordArg(msg.w);
    if (!c || w === null || c.t.setter !== c.seat.side || c.t.phase !== 'hint') return;
    const r = L.addHint(c.g, c.seat.side, w);
    if (!r.ok) return send(client.ws, 'reject', { err: r.err, w });
    if (r.guessNow) armGuess(c.room);
    pushRoom(c.room);
  },
  // 출제자가 쓸 만한 힌트 하나 (출제자에게만)
  suggest(client) {
    const c = current(client);
    if (!c || c.t.setter !== c.seat.side || c.t.phase !== 'hint') return;
    const h = L.cpuHint(c.g);
    if (h >= 0) send(client.ws, 'suggestion', { w: E.words[h], sim: E.table(c.t.secret).score(h) });
  },
  guess(client, msg) {
    const c = current(client), w = wordArg(msg.w);
    if (!c || w === null || c.t.guesser !== c.seat.side || c.t.phase !== 'guess') return;
    const r = L.guess(c.g, c.seat.side, w);
    if (!r.ok) return send(client.ws, 'reject', { err: r.err, w });
    afterGuess(c.room, r);
    pushRoom(c.room);
  },
  // 틀린 뒤: 피스로 한 번 더, 또는 넘기기
  piece(client) {
    const c = current(client);
    if (!c || c.t.guesser !== c.seat.side) return;
    if (L.usePiece(c.g, c.seat.side).ok) pushRoom(c.room);
  },
  pass(client) {
    const c = current(client);
    if (!c || c.t.guesser !== c.seat.side) return;
    const r = L.passExtra(c.g, c.seat.side);
    if (r.ok) { afterGuess(c.room, r); pushRoom(c.room); }
  },
  next(client) {
    const c = current(client);
    if (!c || !c.t.done) return;
    c.room.nextReady.add(c.seat.side);
    if (c.room.nextReady.size >= 2) advance(c.room);
    pushRoom(c.room);
  },
  rematch(client) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (!seat || room.state !== 'over' || room.seats.length < 2) return;
    room.rematch.add(seat.side);
    if (room.rematch.size === 2) startGame(room, false);
    else pushRoom(room);
  },
  leave(client) {
    dropFromQueue(client);
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (seat) vacate(room, seat);
  },
  pulse() {},
};

// ---------- Connections ----------
function onDisconnect(client) {
  dropFromQueue(client);
  const room = rooms.get(client.roomCode);
  const seat = room && seatOf(room, client);
  if (!seat) return;
  if (room.state !== 'playing') { vacate(room, seat); return; }
  seat.online = false; seat.client = null;
  seat.graceTimer = setTimeout(() => vacate(room, seat), GRACE_MS);
  pushRoom(room);
}
const heartbeat = setInterval(() => { for (const ws of wss.clients) ws.ping(); }, HEARTBEAT_MS);
const silenceSweep = setInterval(() => {
  const now = Date.now();
  for (const [ws, client] of clients) if (now - client.lastSeen > SILENCE_TIMEOUT_MS) ws.terminate();
}, 5000);
wss.on('close', () => { clearInterval(heartbeat); clearInterval(silenceSweep); });

wss.on('connection', (ws, req) => {
  ws.on('error', () => {});
  const client = { id: nextId++, ws, ip: clientIp(req), name: sanitizeName(''), roomCode: null, lastSeen: Date.now() };
  clients.set(ws, client);
  ws.on('message', (raw) => {
    client.lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const handler = msg && typeof msg.t === 'string' && Object.prototype.hasOwnProperty.call(handlers, msg.t) ? handlers[msg.t] : null;
    if (handler) handler(client, msg);
  });
  ws.on('close', () => { onDisconnect(client); clients.delete(ws); });
});

server.listen(PORT, () => {
  console.log(`숨은 단어 서버 실행 중 → http://localhost:${PORT}`);
});
