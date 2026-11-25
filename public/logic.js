'use strict';
// 숨은 단어: 규칙과 컴퓨터 (DOM 없음). 화면은 game.js, 온라인 판정은 server.js 가 같이 쓴다.
// 규칙(방송 「히든 워드」를 1:1 로):
// - 처음에 각자 정답 후보 5개를 받고, 1라운드에 그중 하나, 2라운드에 남은 4개 중 하나를 숨긴다.
// - 출제자는 힌트를 하나씩 낸다. 힌트마다 숨긴 단어와의 유사도(%)가 공개되고, 95% 이상인 힌트가 나와야 힌트 단계가 끝난다.
// - 맞히는 쪽은 답을 하나 쓴다(피스를 쓰면 하나 더). 답은 맞음·틀림만 알려 주고 유사도는 보여 주지 않는다.
// - 맞히면 맞힌 쪽 1점, 차례 끝. 못 맞히면 출제자가 단계 점수(1차 1점, 2차 2점, 3차 3점)를 얻고 다음 힌트 단계로. 3차까지.
// - 2라운드는 모든 점수 2배.
// 유사도 엔진: fastText 한국어 단어 벡터(CC BY-SA 3.0)를 명사 약 1.9만 개, 100차원 int8 로 줄인 것 (data/).
const LOGIC_SW = (() => {
  const DIM = 100;
  const STAGES = 3;
  const PASS = 95;            // 이 유사도(%) 이상인 힌트가 나오면 힌트 단계 끝
  const STAGE_PTS = [1, 2, 3]; // 못 맞혔을 때 출제자가 얻는 단계 점수
  const GUESS_PT = 1;          // 맞힌 쪽 점수
  const DECK = 5;              // 처음에 받는 정답 후보 수
  const PIECES = 2;            // 한 판에 쓸 수 있는 피스(답 하나 더)
  const LOW = -0.1;            // 유사도 0% 에 해당하는 코사인
  const LEVELS = ['easy', 'normal', 'hard'];

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const gauss = (rng) => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // 코사인 → 유사도(%). 숨긴 단어와 10번째로 가까운 단어가 정확히 95%, 가장 가까운 단어가 99.99% 가 되게 맞춘 눈금
  function scoreFrom(cos, c1, c10) {
    if (cos >= c10) return Math.min(99.99, PASS + (99.99 - PASS) * (cos - c10) / Math.max(1e-6, c1 - c10));
    return Math.max(0, PASS * (cos - LOW) / Math.max(1e-6, c10 - LOW));
  }

  // ---------- 유사도 엔진 ----------
  // wordsText: '단어\t표시' 줄들 (2 = 정답 후보, 1 = 컴퓨터 힌트·추측용, 0 = 사람이 써도 되는 단어)
  // vec: Int8Array (단어 수 × 100), anchors: Float32Array (단어 수 × 2: 가장 가까운 단어·10번째 단어의 코사인, 없어도 됨)
  function makeEngine(wordsText, vec, anchors) {
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
    // 숨긴 단어 하나에 대한 모든 단어의 코사인·순위·유사도(%)
    const cache = new Map();
    function table(secret) {
      if (cache.has(secret)) return cache.get(secret);
      const sims = new Float32Array(N); for (let i = 0; i < N; i++) sims[i] = sim(secret, i);
      const order = Array.from({ length: N }, (_, i) => i).filter((i) => i !== secret).sort((a, b) => sims[b] - sims[a]);
      const rank = new Int32Array(N); order.forEach((w, r) => { rank[w] = r + 1; }); rank[secret] = 0;
      const c1 = sims[order[0]], c10 = sims[order[9]];
      const score = (i) => (i === secret ? 100 : scoreFrom(sims[i], c1, c10));
      const t = { sims, rank, order, c1, c10, score }; if (cache.size > 40) cache.clear(); cache.set(secret, t); return t;
    }
    const norm = (s) => String(s || '').trim().replace(/\s+/g, '');
    return { N, words, flag, idx, sim, table, answers, hintable, anchors: anchors || null, vec: v, find: (w) => { const i = idx.get(norm(w)); return i === undefined ? -1 : i; } };
  }
  const fmt = (s) => (Math.floor(s * 100) / 100).toFixed(2); // 화면에 보일 유사도(내림, 소수 둘째 자리)
  // 힌트로 쓸 수 없는 단어: 숨긴 단어와 글자가 겹치는 단어
  const overlaps = (E, i, secret) => { const w = E.words[i], s = E.words[secret]; return w.includes(s) || s.includes(w); };

  // ---------- 한 판 ----------
  // 차례 순서: 라운드마다 'cpu' 쪽이 먼저 출제, 그다음 'you'. 연습은 1라운드만
  function newGame(E, opts = {}) {
    const rounds = opts.rounds || 2;
    const order = []; for (let r = 1; r <= rounds; r++) order.push({ round: r, setter: 'cpu' }, { round: r, setter: 'you' });
    const rng = mulberry32(opts.seed || 1);
    const pool = shuffle(E.answers.slice(), rng);
    const deck = opts.decks || { cpu: pool.slice(0, DECK), you: pool.slice(DECK, DECK * 2) };
    const g = { E, level: opts.level || 'normal', rng, order, ti: -1, score: { you: 0, cpu: 0 }, history: [], over: false, tutorial: !!opts.tutorial, noise: new Map(),
      deck: { cpu: deck.cpu.slice(), you: deck.you.slice() }, pieces: { you: PIECES, cpu: PIECES } };
    beginTurn(g);
    return g;
  }
  function beginTurn(g) {
    g.ti++;
    if (g.ti >= g.order.length) { g.over = true; g.t = null; return; }
    const o = g.order[g.ti];
    g.t = { round: o.round, setter: o.setter, guesser: o.setter === 'cpu' ? 'you' : 'cpu', secret: -1, stage: 1, phase: 'secret', allow: 1, hints: [], guesses: [], done: false, solved: false, pts: { setter: 0, guesser: 0 } };
  }
  const mult = (g) => (g.t ? g.t.round : 1);
  const stageHints = (t) => t.hints.filter((h) => h.stage === t.stage);
  const stageGuesses = (t) => t.guesses.filter((h) => h.stage === t.stage);

  function setSecret(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'secret' || t.setter !== side) return { ok: false, err: 'turn' };
    const i = typeof word === 'number' ? word : g.E.find(word);
    if (!g.deck[side].includes(i)) return { ok: false, err: 'notInDeck' };
    g.deck[side] = g.deck[side].filter((x) => x !== i);
    t.secret = i; t.phase = 'hint'; g.E.table(i);
    return { ok: true };
  }
  // 아직 쓰지 않은 95% 이상 힌트가 남아 있는지 (없으면 그 단계는 가장 가까운 힌트로 끝낸다)
  function pass95Left(g) {
    const t = g.t, tb = g.E.table(t.secret);
    for (let r = 0; r < 10; r++) { const i = tb.order[r]; if (!overlaps(g.E, i, t.secret) && !t.hints.some((h) => h.i === i)) return true; }
    return false;
  }
  function checkHint(g, word) {
    const t = g.t, E = g.E, i = typeof word === 'number' ? word : E.find(word);
    if (i < 0) return { ok: false, err: 'unknown' };
    if (i === t.secret) return { ok: false, err: 'secret' };
    if (overlaps(E, i, t.secret)) return { ok: false, err: 'contains' };
    if (t.hints.some((h) => h.i === i)) return { ok: false, err: 'used' };
    return { ok: true, i, sim: E.table(t.secret).score(i) };
  }
  function addHint(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'hint' || t.setter !== side) return { ok: false, err: 'turn' };
    const c = checkHint(g, word); if (!c.ok) return c;
    const last = !pass95Left(g) || c.sim >= PASS;
    t.hints.push({ i: c.i, word: g.E.words[c.i], sim: c.sim, stage: t.stage });
    if (last) { t.phase = 'guess'; t.allow = 1; }
    return { ok: true, sim: c.sim, pass: c.sim >= PASS, guessNow: last };
  }
  function guess(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'guess' || t.guesser !== side) return { ok: false, err: 'turn' };
    const E = g.E, i = typeof word === 'number' ? word : E.find(word);
    if (i < 0) return { ok: false, err: 'unknown' };
    if (t.guesses.some((h) => h.i === i)) return { ok: false, err: 'used' };
    if (t.hints.some((h) => h.i === i)) return { ok: false, err: 'isHint' };
    const correct = i === t.secret;
    t.guesses.push({ i, word: E.words[i], stage: t.stage, correct });
    if (correct) {
      const p = GUESS_PT * mult(g); g.score[t.guesser] += p; t.pts.guesser += p; t.solved = true;
      finishTurn(g); return { ok: true, correct: true, turnOver: true };
    }
    if (stageGuesses(t).length < t.allow) return { ok: true, correct: false };
    if (t.allow === 1 && g.pieces[t.guesser] > 0) { t.phase = 'extra'; return { ok: true, correct: false, canPiece: true }; }
    return Object.assign({ ok: true, correct: false }, endStage(g));
  }
  // 피스 1개로 이번 단계에 답 하나 더
  function usePiece(g, side) {
    const t = g.t; if (!t || t.phase !== 'extra' || t.guesser !== side || g.pieces[side] <= 0) return { ok: false, err: 'turn' };
    g.pieces[side]--; t.allow = 2; t.phase = 'guess';
    return { ok: true };
  }
  function passExtra(g, side) {
    const t = g.t; if (!t || t.phase !== 'extra' || t.guesser !== side) return { ok: false, err: 'turn' };
    return Object.assign({ ok: true }, endStage(g));
  }
  // 이번 단계를 못 맞힘: 출제자 단계 점수, 다음 단계 또는 차례 끝
  function endStage(g) {
    const t = g.t, p = STAGE_PTS[t.stage - 1] * mult(g);
    g.score[t.setter] += p; t.pts.setter += p;
    if (t.stage < STAGES) { t.stage++; t.phase = 'hint'; t.allow = 1; return { stagePts: p, nextStage: true }; }
    finishTurn(g); return { stagePts: p, turnOver: true };
  }
  // 제한 시간이 지나 답을 내지 못함(온라인)
  function forfeitGuesses(g) {
    const t = g.t; if (!t || (t.phase !== 'guess' && t.phase !== 'extra')) return { ok: false, err: 'turn' };
    return Object.assign({ ok: true }, endStage(g));
  }
  function finishTurn(g) {
    const t = g.t; t.done = true; t.phase = 'done';
    g.history.push({ round: t.round, setter: t.setter, secret: t.secret, word: g.E.words[t.secret], solved: t.solved, stage: t.stage, pts: Object.assign({}, t.pts), hints: t.hints.slice(), guesses: t.guesses.slice() });
  }
  function nextTurn(g) { if (g.t && !g.t.done) return false; beginTurn(g); return true; }
  const winner = (g) => (g.score.you > g.score.cpu ? 'you' : g.score.cpu > g.score.you ? 'cpu' : null);

  // ---------- 컴퓨터 ----------
  // 출제: 단계마다 '먼저 내는 힌트' 몇 개(유사도 범위 안) → 마지막에 95% 이상 힌트
  const HINT_STYLE = {
    tutor: { leads: [1, 1], band: [80, 94] },
    easy: { leads: [1, 1], band: [75, 94] },
    normal: { leads: [1, 3], band: [55, 90] },
    hard: { leads: [2, 4], band: [40, 85] },
  };
  // 맞히기: 힌트 유사도를 흐릿하게 읽는 정도(표준편차, %p). 낮을수록 잘 맞힌다
  const NOISE = { tutor: 14, easy: 30, normal: 18, hard: 9 };
  const styleOf = (g) => (g.tutorial ? 'tutor' : g.level);

  function cpuSecret(g) {
    const d = g.deck[g.t.setter];
    return d[Math.floor(g.rng() * d.length)];
  }
  function cpuHint(g, opts = {}) {
    const t = g.t, E = g.E, tb = E.table(t.secret), st = HINT_STYLE[styleOf(g)] || HINT_STYLE.normal;
    if (t.plan === undefined || t.planStage !== t.stage) { t.plan = st.leads[0] + Math.floor(g.rng() * (st.leads[1] - st.leads[0] + 1)); t.planStage = t.stage; }
    const want95 = opts.finish || stageHints(t).length >= t.plan;
    const free = (i) => !overlaps(E, i, t.secret) && !t.hints.some((h) => h.i === i) && !t.guesses.some((h) => h.i === i);
    if (want95) {
      const top = tb.order.slice(0, 10).filter(free);
      if (!top.length) { for (const i of tb.order) if (free(i)) return i; return -1; }
      if (styleOf(g) === 'tutor' || styleOf(g) === 'easy') return top[0];
      if (styleOf(g) === 'hard') return top[top.length - 1];
      return top[Math.floor(g.rng() * top.length)];
    }
    let cand = [];
    for (let r = 10; r < Math.min(tb.order.length, 4000); r++) {
      const i = tb.order[r]; if (E.flag[i] < 1 || !free(i)) continue;
      const s = tb.score(i); if (s >= st.band[0] && s <= st.band[1]) cand.push(i);
    }
    shuffle(cand, g.rng);
    if (styleOf(g) === 'hard') {
      // 다른 정답 후보에도 가까운(헷갈리는) 단어를 고른다
      const others = E.answers.filter((a) => a !== t.secret);
      const conf = (i) => { let m = -1; for (const a of others) { const s = E.sim(i, a); if (s > m) m = s; } return m - tb.sims[i]; };
      cand = cand.slice(0, 40).sort((a, b) => conf(b) - conf(a));
    }
    if (cand.length) return cand[0];
    return cpuHint(g, { finish: true });
  }
  // 힌트 유사도와 가장 잘 맞는 단어. 정답 후보 목록은 모르는 채로(사람과 같은 조건) 힌트용 단어 1만여 개에서 찾는다
  function cpuGuess(g) {
    const t = g.t, E = g.E, sd = NOISE[styleOf(g)] || NOISE.normal, A = E.anchors;
    const obs = t.hints.map((h) => {
      const key = g.ti + ':' + h.i; if (!g.noise.has(key)) g.noise.set(key, gauss(g.rng) * sd);
      return { i: h.i, s: h.sim + g.noise.get(key) };
    });
    const skip = new Set(t.guesses.map((h) => h.i).concat(t.hints.map((h) => h.i)));
    let best = -1, bestErr = Infinity;
    for (const c of E.hintable) {
      if (skip.has(c) || obs.some((o) => overlaps(E, o.i, c))) continue;
      const c1 = A ? A[c * 2] : 0.6, c10 = A ? A[c * 2 + 1] : 0.45;
      let err = 0;
      for (const o of obs) { const d = scoreFrom(E.sim(c, o.i), c1, c10) - o.s; err += d * d; if (err >= bestErr) break; }
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return best;
  }
  function cpuWantsPiece(g) {
    const t = g.t, lv = styleOf(g);
    if (g.pieces[t.guesser] <= 0) return false;
    if (lv === 'tutor') return false;
    if (lv === 'hard') return true;
    return t.stage >= (lv === 'easy' ? 3 : 2);
  }

  // 컴퓨터끼리 한 차례(시험·조정용): 출제 setLv, 맞히기 guessLv. 돌려주는 값: { solved, stage, hints }
  function simulateTurn(E, setLv, guessLv, seed) {
    const g = newGame(E, { seed, rounds: 1 });
    g.level = setLv; setSecret(g, 'cpu', cpuSecret(g));
    let guard = 0;
    while (!g.t.done && guard++ < 200) {
      const t = g.t;
      if (t.phase === 'hint') { g.level = setLv; const h = cpuHint(g); if (h < 0) break; addHint(g, 'cpu', h); }
      else if (t.phase === 'guess') { g.level = guessLv; guess(g, 'you', cpuGuess(g)); }
      else if (t.phase === 'extra') { g.level = guessLv; if (cpuWantsPiece(g)) usePiece(g, 'you'); else passExtra(g, 'you'); }
    }
    return { solved: g.t.solved, stage: g.t.stage, hints: g.t.hints.length };
  }

  const api = { NOISE, HINT_STYLE, DIM, STAGES, PASS, STAGE_PTS, GUESS_PT, DECK, PIECES, LEVELS, mulberry32, scoreFrom, makeEngine, fmt, newGame, setSecret, checkHint, addHint, guess, usePiece, passExtra, forfeitGuesses, nextTurn, winner, cpuSecret, cpuHint, cpuGuess, cpuWantsPiece, simulateTurn, stageHints, stageGuesses, pass95Left };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
