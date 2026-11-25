'use strict';
// 숨은 단어: 규칙과 컴퓨터 (DOM 없음). 화면은 game.js
// 출제자는 정답 단어를 숨기고 '가까운 단어'를 힌트로 낸다. 맞히는 쪽은 힌트와 내 답의 유사도·순위를 보고 정답을 찾는다.
// 유사도 엔진: fastText 한국어 단어 벡터(CC BY-SA 3.0)를 명사 약 1.9만 개로 줄이고 100차원 int8 로 압축한 것 (data/).
const LOGIC_SW = (() => {
  const DIM = 100;
  const STAGES = 3, HINTS_PER_STAGE = 2, GUESSES_PER_STAGE = 3;
  const RANK_LIMIT = [300, 100, 30]; // 단계별 힌트가 들어야 하는 순위(1 = 정답과 가장 가까운 단어)
  const MIN_RANK = 4;                // 1~3위는 너무 가까워서 힌트로 못 쓴다
  const GUESS_PTS = [3, 2, 1];       // 맞힌 단계별 점수
  const SETTER_PTS = 2;              // 끝까지 못 맞히면 출제자 점수
  const LEVELS = ['easy', 'normal', 'hard'];

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const gauss = (rng) => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // ---------- 유사도 엔진 ----------
  // wordsText: '단어\t표시' 줄들 (2 = 정답 후보, 1 = 컴퓨터 힌트용, 0 = 맞히기만), vec: Int8Array (단어 수 × 100)
  function makeEngine(wordsText, vec) {
    const words = [], flag = [];
    for (const line of wordsText.split('\n')) { if (!line) continue; const [w, f] = line.split('\t'); words.push(w); flag.push(+f || 0); }
    const N = words.length, idx = new Map(words.map((w, i) => [w, i]));
    const v = new Float32Array(N * DIM);
    for (let i = 0; i < N; i++) {
      let s = 0; for (let k = 0; k < DIM; k++) s += vec[i * DIM + k] * vec[i * DIM + k];
      s = Math.sqrt(s) || 1; for (let k = 0; k < DIM; k++) v[i * DIM + k] = vec[i * DIM + k] / s;
    }
    const sim = (a, b) => { let s = 0; const oa = a * DIM, ob = b * DIM; for (let k = 0; k < DIM; k++) s += v[oa + k] * v[ob + k]; return s; };
    const answers = [], hintable = [];
    flag.forEach((f, i) => { if (f === 2) answers.push(i); if (f >= 1) hintable.push(i); }); // hintable 에는 정답 후보도 들어 있다
    // 정답 하나에 대한 모든 단어의 유사도와 순위
    const cache = new Map();
    function table(secret) {
      if (cache.has(secret)) return cache.get(secret);
      const sims = new Float32Array(N); for (let i = 0; i < N; i++) sims[i] = sim(secret, i);
      const order = Array.from({ length: N }, (_, i) => i).filter((i) => i !== secret).sort((a, b) => sims[b] - sims[a]);
      const rank = new Int32Array(N); order.forEach((w, r) => { rank[w] = r + 1; }); rank[secret] = 0;
      const t = { sims, rank, order }; if (cache.size > 40) cache.clear(); cache.set(secret, t); return t;
    }
    const norm = (s) => String(s || '').trim().replace(/\s+/g, '');
    return { N, words, flag, idx, sim, table, answers, hintable, find: (w) => { const i = idx.get(norm(w)); return i === undefined ? -1 : i; } };
  }
  const pct = (s) => Math.round(s * 10000) / 100; // 화면에 보일 유사도(소수 둘째 자리까지)

  // ---------- 한 판 ----------
  // 차례 순서: 1라운드 컴퓨터 출제 → 내 출제, 2라운드(점수 2배) 같은 순서. 연습은 1라운드만
  function newGame(E, opts = {}) {
    const rounds = opts.rounds || 2;
    const order = []; for (let r = 1; r <= rounds; r++) order.push({ round: r, setter: 'cpu' }, { round: r, setter: 'you' });
    const g = { E, level: opts.level || 'normal', rng: mulberry32(opts.seed || 1), order, ti: -1, score: { you: 0, cpu: 0 }, history: [], over: false, tutorial: !!opts.tutorial, noise: new Map() };
    beginTurn(g);
    return g;
  }
  function beginTurn(g) {
    g.ti++;
    if (g.ti >= g.order.length) { g.over = true; g.t = null; return; }
    const o = g.order[g.ti];
    g.t = { round: o.round, setter: o.setter, guesser: o.setter === 'cpu' ? 'you' : 'cpu', secret: -1, stage: 1, phase: 'secret', hints: [], guesses: [], done: false, result: null };
  }
  const mult = (g) => (g.t ? g.t.round : 1);
  const stageHints = (t) => t.hints.filter((h) => h.stage === t.stage);
  const stageGuesses = (t) => t.guesses.filter((h) => h.stage === t.stage);

  function setSecret(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'secret' || t.setter !== side) return { ok: false, err: 'turn' };
    const i = typeof word === 'number' ? word : g.E.find(word);
    if (i < 0 || g.E.flag[i] !== 2) return { ok: false, err: 'notAnswer' };
    if (g.history.some((h) => h.secret === i)) return { ok: false, err: 'usedSecret' };
    t.secret = i; t.phase = 'hint'; g.E.table(i);
    return { ok: true };
  }
  // 힌트로 쓸 수 있는지(출제자만 미리 본다)
  function checkHint(g, word) {
    const t = g.t, E = g.E, i = typeof word === 'number' ? word : E.find(word);
    if (i < 0) return { ok: false, err: 'unknown' };
    if (i === t.secret) return { ok: false, err: 'secret' };
    const w = E.words[i], s = E.words[t.secret];
    if (w.includes(s) || s.includes(w)) return { ok: false, err: 'contains' };
    if (t.hints.some((h) => h.i === i) || t.guesses.some((h) => h.i === i)) return { ok: false, err: 'used' };
    const tb = E.table(t.secret), rank = tb.rank[i], limit = RANK_LIMIT[t.stage - 1];
    if (rank < MIN_RANK) return { ok: false, err: 'close', rank, sim: tb.sims[i] };
    if (rank > limit) return { ok: false, err: 'far', rank, sim: tb.sims[i], limit };
    return { ok: true, i, rank, sim: tb.sims[i] };
  }
  function addHint(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'hint' || t.setter !== side) return { ok: false, err: 'turn' };
    const c = checkHint(g, word); if (!c.ok) return c;
    t.hints.push({ i: c.i, word: g.E.words[c.i], sim: c.sim, rank: c.rank, stage: t.stage });
    if (stageHints(t).length >= HINTS_PER_STAGE) t.phase = 'guess';
    return { ok: true, rank: c.rank, sim: c.sim };
  }
  function guess(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'guess' || t.guesser !== side) return { ok: false, err: 'turn' };
    const E = g.E, i = typeof word === 'number' ? word : E.find(word);
    if (i < 0) return { ok: false, err: 'unknown' };
    if (t.guesses.some((h) => h.i === i) || t.hints.some((h) => h.i === i)) return { ok: false, err: 'used' };
    const tb = E.table(t.secret), correct = i === t.secret;
    t.guesses.push({ i, word: E.words[i], sim: tb.sims[i], rank: tb.rank[i], stage: t.stage, correct });
    const res = { ok: true, correct, sim: tb.sims[i], rank: tb.rank[i] };
    if (correct) finishTurn(g, t.guesser, GUESS_PTS[t.stage - 1] * mult(g));
    else if (stageGuesses(t).length >= GUESSES_PER_STAGE) {
      if (t.stage < STAGES) { t.stage++; t.phase = 'hint'; res.nextStage = true; }
      else finishTurn(g, t.setter, SETTER_PTS * mult(g));
    }
    if (t.done) res.turnOver = true;
    return res;
  }
  function finishTurn(g, who, pts) {
    const t = g.t; t.done = true; t.phase = 'done'; t.result = { who, pts };
    g.score[who] += pts;
    g.history.push({ round: t.round, setter: t.setter, secret: t.secret, word: g.E.words[t.secret], who, pts, stage: t.stage, hints: t.hints.slice(), guesses: t.guesses.slice() });
  }
  // 제한 시간이 지나 남은 답을 버린다(온라인). 다음 단계로, 3단계였으면 출제자 점수
  function forfeitGuesses(g) {
    const t = g.t; if (!t || t.phase !== 'guess') return { ok: false, err: 'turn' };
    if (t.stage < STAGES) { t.stage++; t.phase = 'hint'; return { ok: true, nextStage: true }; }
    finishTurn(g, t.setter, SETTER_PTS * mult(g)); return { ok: true, turnOver: true };
  }
  function nextTurn(g) { if (g.t && !g.t.done) return false; beginTurn(g); return true; }
  const winner = (g) => (g.score.you > g.score.cpu ? 'you' : g.score.cpu > g.score.you ? 'cpu' : null);

  // ---------- 컴퓨터 ----------
  const HINT_BAND = { tutor: [0, 0.03], easy: [0, 0.35], normal: [0.3, 1], hard: [0.55, 1] };
  // 유사도를 읽는 흐릿함(표준편차). 후보는 정답 후보만이 아니라 힌트용 단어 1만여 개 전체라 사람과 같은 조건이다
  const NOISE = { tutor: 0.12, easy: 0.2, normal: 0.13, hard: 0.08 };
  function cpuSecret(g) {
    const used = new Set(g.history.map((h) => h.secret));
    const pool = g.E.answers.filter((i) => !used.has(i));
    return pool[Math.floor(g.rng() * pool.length)];
  }
  function cpuHint(g) {
    const t = g.t, E = g.E, tb = E.table(t.secret), limit = RANK_LIMIT[t.stage - 1];
    const band = HINT_BAND[g.tutorial ? 'tutor' : g.level] || HINT_BAND.normal;
    const lo = Math.max(MIN_RANK, Math.floor(limit * band[0])), hi = Math.max(lo + 2, Math.ceil(limit * band[1]));
    let cand = [];
    for (let r = lo; r <= Math.min(hi, limit); r++) { const i = tb.order[r - 1]; if (E.flag[i] >= 1 && checkHint(g, i).ok) cand.push(i); }
    if (!cand.length) for (let r = MIN_RANK; r <= limit; r++) { const i = tb.order[r - 1]; if (checkHint(g, i).ok) cand.push(i); }
    shuffle(cand, g.rng);
    if (g.level === 'hard' && !g.tutorial) {
      // 다른 정답 후보에도 가까운(헷갈리는) 단어를 고른다
      const others = E.answers.filter((a) => a !== t.secret);
      const conf = (i) => { let m = -1; for (const a of others) { const s = E.sim(i, a); if (s > m) m = s; } return m - tb.sims[i]; };
      cand = cand.slice(0, 40).sort((a, b) => conf(b) - conf(a));
    }
    return cand.length ? cand[0] : -1;
  }
  // 힌트·지난 답의 유사도와 가장 잘 맞는 정답 후보. 난이도가 낮을수록 유사도를 흐릿하게 읽는다
  function cpuGuess(g) {
    const t = g.t, E = g.E, sd = NOISE[g.tutorial ? 'tutor' : g.level] || NOISE.normal;
    const obs = t.hints.concat(t.guesses).map((h) => {
      const key = g.ti + ':' + h.i; if (!g.noise.has(key)) g.noise.set(key, gauss(g.rng) * sd);
      return { i: h.i, s: h.sim + g.noise.get(key) };
    });
    const tried = new Set(t.guesses.map((h) => h.i));
    const scored = E.hintable.filter((a) => !tried.has(a) && !t.hints.some((h) => h.i === a)).map((a) => {
      let err = 0; for (const o of obs) { const d = E.sim(a, o.i) - o.s; err += d * d; }
      return { a, err };
    }).sort((x, y) => x.err - y.err);
    if (!scored.length) return -1;
    return scored[0].a;
  }

  // 컴퓨터끼리 한 차례(시험용): 출제 난이도 setLv, 맞히는 난이도 guessLv. 돌려주는 값: 맞힌 단계(1~3) 또는 0
  function simulateTurn(E, setLv, guessLv, seed) {
    const g = newGame(E, { seed, rounds: 1 });
    g.level = setLv; setSecret(g, 'cpu', cpuSecret(g));
    while (!g.t.done) {
      if (g.t.phase === 'hint') { g.level = setLv; const h = cpuHint(g); if (h < 0) break; addHint(g, 'cpu', h); }
      else { g.level = guessLv; const r = guess(g, 'you', cpuGuess(g)); if (r.correct) return g.t.stage; }
    }
    return 0;
  }

  const api = { NOISE, HINT_BAND, DIM, STAGES, HINTS_PER_STAGE, GUESSES_PER_STAGE, RANK_LIMIT, MIN_RANK, GUESS_PTS, SETTER_PTS, LEVELS, mulberry32, makeEngine, pct, newGame, setSecret, checkHint, addHint, guess, forfeitGuesses, nextTurn, winner, cpuSecret, cpuHint, cpuGuess, simulateTurn, stageHints, stageGuesses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
