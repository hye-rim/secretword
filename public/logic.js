'use strict';
// 숨은 단어: 규칙과 컴퓨터 (DOM 없음). 화면은 game.js, 온라인 판정은 server.js 가 같이 쓴다.
// 규칙(방송 「히든 워드」를 1:1 로):
// - 처음에 각자 정답 후보 5개를 받고, 1라운드에 그중 하나, 2라운드에 남은 4개 중 하나를 숨긴다.
// - 출제자는 힌트를 하나씩 낸다. 힌트마다 숨긴 단어와의 유사도(%)가 공개된다. 95% 이상인 힌트가 나오면 바로, 아니면 힌트 10개를 내면 힌트 단계가 끝난다.
// - 맞히는 쪽은 답을 하나 쓴다(피스를 쓰면 하나 더). 답은 맞음·틀림만 알려 주고 유사도는 보여 주지 않는다.
// - 맞히면 맞힌 쪽 1점, 차례 끝. 못 맞히면 출제자가 단계 점수(1차 1점, 2차 2점, 3차 3점)를 얻고 다음 힌트 단계로. 3차까지.
// - 2라운드는 모든 점수 2배.
// 유사도 = 두 가지를 합친다 (README 「단어 자료」·「유사도」):
//   ① 연상 목록(data/assoc.json): 정답 후보 252개마다 모든 뜻을 담은 연상 단어를 가까운 순으로 적어 둔 것.
//      방송 AI 처럼 연상·여러 뜻을 후하게 쳐 준다(앞 5개 95% 이상, 끝으로 갈수록 80%까지).
//   ② 단어 벡터(data/vecs.bin, 약 2만 단어 int8): 목록에 없는 단어. KURE-v1(연상 틀) + KR-SBERT + fastText 를 섞어 192차원.
//      한국어 WS-353(사람이 매긴 353쌍)과 스피어만 0.79. 목록 밖 단어는 88% 를 넘지 않게, 정답을 품지 않으면서 글자만 나눠 가진 단어는 깎는다
const LOGIC_SW = (() => {
  const STAGES = 3;
  const PASS = 95;            // 이 유사도(%) 이상인 힌트가 나오면 힌트 단계 바로 끝
  const MAX_HINTS = 10;       // 아니면 한 단계에 힌트 10개를 내면 끝
  const STAGE_PTS = [1, 2, 3]; // 못 맞혔을 때 출제자가 얻는 단계 점수
  const GUESS_PT = 1;          // 맞힌 쪽 점수
  const DECK = 5;              // 처음에 받는 정답 후보 수
  const PIECES = 2;            // 한 판에 쓸 수 있는 피스(답 하나 더)
  const LEVELS = ['easy', 'normal', 'hard'];

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const gauss = (rng) => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // 목록 밖 단어: 코사인 → % 곡선(S자). 관련 없는 단어 0~15%, 조금 관련 40~60%, 뚜렷한 관련 75~85%, 88% 까지만
  // (방송 기록의 관련 없는 쌍: 질책 2.5, 소설 5, 지구 8.5 에 맞추고, 목록 밖은 후하게 주지 않는다)
  const MODEL_K = 12, MODEL_C0 = 0.2, MODEL_CAP = 88;
  function scoreFrom(cos) { return MODEL_CAP / (1 + Math.exp(-MODEL_K * (cos - MODEL_C0))); }
  // 목록 안 단어: 순서 p(0부터), 목록 길이 n → 앞 5개 99.5~95.5, 그 뒤 94 → 80 (0.5 단위, 방송처럼)
  function listScore(p, n) {
    const v = p < 5 ? 99.5 - p : 94 - (p - 5) * (14 / Math.max(1, n - 6));
    return Math.round(Math.max(80, v) * 2) / 2;
  }
  const shareSyllable = (a, b) => { for (const ch of a) if (b.includes(ch)) return true; return false; };

  // ---------- 유사도 엔진 ----------
  // wordsText: '단어\t표시' 줄들 (2 = 정답 후보, 1 = 컴퓨터 힌트·추측용, 0 = 사람이 써도 되는 단어)
  // vec: Int8Array (단어 수 × 차원). 차원은 길이로 안다. assoc: { 정답: [연상 단어, …] } (없어도 됨)
  function makeEngine(wordsText, vec, assoc) {
    const words = [], flag = [];
    for (const line of wordsText.split('\n')) { if (!line) continue; const [w, f] = line.split('\t'); words.push(w); flag.push(+f || 0); }
    const N = words.length, idx = new Map(words.map((w, i) => [w, i])), DIM = Math.round(vec.length / N);
    const v = new Float32Array(N * DIM);
    for (let i = 0; i < N; i++) {
      let s = 0; for (let k = 0; k < DIM; k++) s += vec[i * DIM + k] * vec[i * DIM + k];
      s = Math.sqrt(s) || 1; for (let k = 0; k < DIM; k++) v[i * DIM + k] = vec[i * DIM + k] / s;
    }
    const sim = (a, b) => { let s = 0; const oa = a * DIM, ob = b * DIM; for (let k = 0; k < DIM; k++) s += v[oa + k] * v[ob + k]; return s; };
    const answers = [], hintable = [];
    flag.forEach((f, i) => { if (f === 2) answers.push(i); if (f >= 1) hintable.push(i); }); // hintable 에는 정답 후보도 들어 있다
    // 연상 목록: 정답 번호 → (단어 번호 → 순서), 목록 길이
    const lists = new Map(), listArr = new Map();
    for (const [k, ws] of Object.entries(assoc || {})) {
      const si = idx.get(k); if (si === undefined) continue;
      const arr = ws.map((w) => idx.get(w)).filter((x) => x !== undefined);
      lists.set(si, new Map(arr.map((x, p) => [x, p]))); listArr.set(si, arr);
    }
    // 정답 secret 에 대한 단어 i 의 유사도(%)
    function pairScore(secret, i, cos) {
      if (i === secret) return 100;
      const L = lists.get(secret);
      if (L && L.has(i)) return listScore(L.get(i), listArr.get(secret).length);
      let s = scoreFrom(cos === undefined ? sim(secret, i) : cos);
      if (L && !words[i].includes(words[secret]) && shareSyllable(words[secret], words[i])) s *= 0.5; // 글자만 닮은 단어(나침반 - 받침대)
      return s;
    }
    // 숨긴 단어 하나에 대한 모든 단어의 코사인·순위·유사도(%)
    const cache = new Map();
    function table(secret) {
      if (cache.has(secret)) return cache.get(secret);
      const sims = new Float32Array(N); for (let i = 0; i < N; i++) sims[i] = sim(secret, i);
      const order = Array.from({ length: N }, (_, i) => i).filter((i) => i !== secret).sort((a, b) => sims[b] - sims[a]);
      const rank = new Int32Array(N); order.forEach((w, r) => { rank[w] = r + 1; }); rank[secret] = 0;
      const score = (i) => pairScore(secret, i, sims[i]);
      const t = { sims, rank, order, score }; if (cache.size > 40) cache.clear(); cache.set(secret, t); return t;
    }
    const norm = (s) => String(s || '').trim().replace(/\s+/g, '');
    return { N, words, flag, idx, sim, table, answers, hintable, dim: DIM, vec: v, pairScore, list: (s) => listArr.get(s) || [], find: (w) => { const i = idx.get(norm(w)); return i === undefined ? -1 : i; } };
  }
  const fmt = (s) => (Math.floor(s * 100) / 100).toFixed(2); // 화면에 보일 유사도(내림, 소수 둘째 자리)
  // 방송처럼 숨긴 단어 자체만 힌트로 못 쓴다(나무 → 소나무 는 됨)

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
  function checkHint(g, word) {
    const t = g.t, E = g.E, i = typeof word === 'number' ? word : E.find(word);
    if (i < 0) return { ok: false, err: 'unknown' };
    if (i === t.secret) return { ok: false, err: 'secret' };
    if (t.hints.some((h) => h.i === i)) return { ok: false, err: 'used' };
    return { ok: true, i, sim: E.table(t.secret).score(i) };
  }
  function addHint(g, side, word) {
    const t = g.t; if (!t || t.phase !== 'hint' || t.setter !== side) return { ok: false, err: 'turn' };
    const c = checkHint(g, word); if (!c.ok) return c;
    const last = c.sim >= PASS || stageHints(t).length + 1 >= MAX_HINTS;
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
  // 출제(방송 출제자처럼): 연상 목록의 중간·뒤쪽 단어로 몇 개 흘린 뒤, 앞쪽(95% 이상) 단어 하나로 그 단계를 끝낸다.
  // [먼저 낼 개수 최소, 최대], 먼저 낼 단어를 고르는 목록 구간 [시작, 끝) — 단계가 갈수록 3칸씩 앞(가까운 쪽)으로
  const HINT_PLAN = {
    tutor: { leads: [1, 2], win: [5, 12] },
    easy: { leads: [1, 2], win: [5, 14] },
    normal: { leads: [2, 3], win: [7, 20] },
    hard: { leads: [3, 5], win: [10, 30] },
  };
  // 맞히기: 힌트 유사도를 흐릿하게 읽는 정도(표준편차, %p). 낮을수록 잘 맞힌다 (방송 눈금은 값이 넓게 퍼져서 크게 잡는다)
  const NOISE = { tutor: 40, easy: 110, normal: 60, hard: 30 };
  const styleOf = (g) => (g.tutorial ? 'tutor' : g.level);

  function cpuSecret(g) {
    const d = g.deck[g.t.setter];
    return d[Math.floor(g.rng() * d.length)];
  }
  function cpuHint(g) {
    const t = g.t, E = g.E, style = styleOf(g), P = HINT_PLAN[style] || HINT_PLAN.normal;
    const free = (i) => i !== t.secret && !t.hints.some((h) => h.i === i) && !t.guesses.some((h) => h.i === i);
    const list = E.list(t.secret).filter(free);
    if (!t.plan || t.planStage !== t.stage) {
      const shift = (t.stage - 1) * 3, lo = Math.max(5, P.win[0] - shift), hi = Math.max(lo + 3, P.win[1] - shift);
      const all = E.list(t.secret);
      const pool = shuffle(all.slice(lo, hi).filter(free), g.rng);
      const n = P.leads[0] + Math.floor(g.rng() * (P.leads[1] - P.leads[0] + 1));
      t.plan = pool.slice(0, n).sort((a, b) => all.indexOf(b) - all.indexOf(a)); // 먼 것부터
      t.planStage = t.stage;
    }
    const next = t.plan.find(free);
    if (next !== undefined && stageHints(t).length < t.plan.length) return next;
    // 마무리: 앞쪽(95% 이상) 단어 하나
    const top = list.filter((i) => E.table(t.secret).score(i) >= PASS);
    if (top.length) return top[Math.floor(g.rng() * top.length)];
    if (list.length) return list[0];
    const tb = E.table(t.secret);
    for (const i of tb.order) if (E.flag[i] >= 1 && free(i)) return i;
    return -1;
  }
  // 힌트 유사도와 가장 잘 맞는 단어. 정답 후보 목록은 모르는 채로(사람과 같은 조건) 힌트용 단어 1만여 개에서 찾는다
  function cpuGuess(g) {
    const t = g.t, E = g.E, sd = NOISE[styleOf(g)] || NOISE.normal;
    const obs = t.hints.map((h) => {
      const key = g.ti + ':' + h.i; if (!g.noise.has(key)) g.noise.set(key, gauss(g.rng) * sd);
      return { i: h.i, s: h.sim + g.noise.get(key) };
    });
    const skip = new Set(t.guesses.map((h) => h.i).concat(t.hints.map((h) => h.i)));
    let best = -1, bestErr = Infinity;
    for (const c of E.hintable) {
      if (skip.has(c)) continue;
      let err = 0;
      for (const o of obs) { const d = E.pairScore(c, o.i) - o.s; err += d * d; if (err >= bestErr) break; }
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

  const api = { NOISE, HINT_PLAN, listScore, STAGES, PASS, MAX_HINTS, STAGE_PTS, GUESS_PT, DECK, PIECES, LEVELS, mulberry32, scoreFrom, makeEngine, fmt, newGame, setSecret, checkHint, addHint, guess, usePiece, passExtra, forfeitGuesses, nextTurn, winner, cpuSecret, cpuHint, cpuGuess, cpuWantsPiece, simulateTurn, stageHints, stageGuesses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
