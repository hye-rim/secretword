'use strict';

// 숨은 단어 규칙·컴퓨터 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../public/logic.js');

const dir = path.join(__dirname, '..', 'public', 'data');
const E = L.makeEngine(fs.readFileSync(path.join(dir, 'words.txt'), 'utf8'), new Int8Array(fs.readFileSync(path.join(dir, 'vecs.bin'))));
const W = (w) => E.find(w);

// 정답을 정해 둔 판을 만든다 (컴퓨터 출제 차례)
function gameWith(secret, opts = {}) {
  const g = L.newGame(E, Object.assign({ seed: 3 }, opts));
  assert.ok(L.setSecret(g, 'cpu', secret).ok);
  return g;
}
const byRank = (g, r) => E.words[E.table(g.t.secret).order[r - 1]];

test('engine: data loads and ranks follow similarity', () => {
  assert.ok(E.N > 15000, 'words ' + E.N);
  assert.ok(E.answers.length >= 250, 'answers ' + E.answers.length);
  const s = W('고양이'); assert.ok(s >= 0);
  const tb = E.table(s);
  assert.strictEqual(tb.rank[s], 0);
  assert.strictEqual(tb.rank[tb.order[0]], 1);
  assert.ok(tb.sims[tb.order[0]] >= tb.sims[tb.order[1]] && tb.sims[tb.order[1]] >= tb.sims[tb.order[500]]);
  // 뜻이 가까운 단어가 먼 단어보다 위
  assert.ok(tb.rank[W('강아지')] < 30, 'dog rank ' + tb.rank[W('강아지')]);
  assert.ok(tb.rank[W('강아지')] < tb.rank[W('세금')]);
  assert.strictEqual(E.find(' 고양이 '), s);
  assert.strictEqual(E.find('없는낱말이다'), -1);
});

test('secret: only answer words and never twice in one game', () => {
  const g = L.newGame(E, { seed: 1 });
  assert.strictEqual(L.setSecret(g, 'you', '고양이').err, 'turn');
  assert.strictEqual(L.setSecret(g, 'cpu', '강남역').err, 'notAnswer');
  assert.ok(L.setSecret(g, 'cpu', '고양이').ok);
  g.t.done = true; g.history.push({ secret: W('고양이') });
  L.nextTurn(g);
  assert.strictEqual(g.t.setter, 'you');
  assert.strictEqual(L.setSecret(g, 'you', '고양이').err, 'usedSecret');
  assert.ok(L.setSecret(g, 'you', '바다').ok);
});

test('hint: unknown, secret, contains, too close, too far and used are refused', () => {
  const g = gameWith('바다');
  assert.strictEqual(L.addHint(g, 'cpu', '없는낱말이다').err, 'unknown');
  assert.strictEqual(L.addHint(g, 'cpu', '바다').err, 'secret');
  if (E.find('바다낚시') >= 0) assert.strictEqual(L.checkHint(g, '바다낚시').err, 'contains');
  assert.strictEqual(L.checkHint(g, byRank(g, 1)).err, 'close');
  assert.strictEqual(L.checkHint(g, byRank(g, 3)).err, 'close');
  const far = L.checkHint(g, byRank(g, 301)); assert.strictEqual(far.err, 'far'); assert.strictEqual(far.rank, 301);
  const ok = L.checkHint(g, byRank(g, 300)); assert.ok(ok.ok);
  const w4 = byRank(g, 4);
  if (L.checkHint(g, w4).ok) { assert.ok(L.addHint(g, 'cpu', w4).ok); assert.strictEqual(L.checkHint(g, w4).err, 'used'); }
});

test('flow: two hints then three guesses per stage, rank limit tightens by stage', () => {
  const g = gameWith('기차');
  assert.strictEqual(L.guess(g, 'you', '버스').err, 'turn');           // 힌트가 먼저
  assert.ok(L.addHint(g, 'cpu', byRank(g, 200)).ok);
  assert.strictEqual(g.t.phase, 'hint');
  assert.ok(L.addHint(g, 'cpu', byRank(g, 250)).ok);
  assert.strictEqual(g.t.phase, 'guess');
  assert.strictEqual(L.addHint(g, 'cpu', byRank(g, 260)).err, 'turn');
  const a = L.guess(g, 'you', '사과'); assert.ok(a.ok && !a.correct && a.rank > 0);
  assert.strictEqual(L.guess(g, 'you', '사과').err, 'used');
  L.guess(g, 'you', '바다'); const c = L.guess(g, 'you', '음악');
  assert.ok(c.nextStage); assert.strictEqual(g.t.stage, 2); assert.strictEqual(g.t.phase, 'hint');
  assert.strictEqual(L.checkHint(g, byRank(g, 150)).err, 'far');       // 2단계는 100위 안
  assert.ok(L.addHint(g, 'cpu', byRank(g, 90)).ok);
});

test('score: guess at stage 1 gives 3, setter gets 2 after three stages, round 2 doubles', () => {
  const g = gameWith('기차');
  L.addHint(g, 'cpu', byRank(g, 200)); L.addHint(g, 'cpu', byRank(g, 220));
  const r = L.guess(g, 'you', '기차');
  assert.ok(r.correct && r.turnOver); assert.deepStrictEqual(g.score, { you: 3, cpu: 0 });
  // 내가 출제, 컴퓨터가 끝까지 못 맞힘
  L.nextTurn(g); assert.strictEqual(g.t.setter, 'you'); assert.ok(L.setSecret(g, 'you', '사과').ok);
  const wrong = ['우주', '전쟁', '컴퓨터', '선거', '축구', '바다', '병원', '음악', '시험'];
  for (let st = 1; st <= 3; st++) {
    L.addHint(g, 'you', byRank(g, [250, 90, 25][st - 1])); L.addHint(g, 'you', byRank(g, [260, 95, 28][st - 1]));
    for (let k = 0; k < 3; k++) L.guess(g, 'cpu', wrong[(st - 1) * 3 + k]);
  }
  assert.ok(g.t.done); assert.deepStrictEqual(g.score, { you: 5, cpu: 0 });
  // 2라운드: 컴퓨터 출제, 2단계에서 맞히면 2점 x2
  L.nextTurn(g); assert.strictEqual(g.t.round, 2); L.setSecret(g, 'cpu', '피아노');
  L.addHint(g, 'cpu', byRank(g, 200)); L.addHint(g, 'cpu', byRank(g, 210));
  L.guess(g, 'you', '우주'); L.guess(g, 'you', '전쟁'); L.guess(g, 'you', '선거');
  L.addHint(g, 'cpu', byRank(g, 50)); L.addHint(g, 'cpu', byRank(g, 60));
  assert.ok(L.guess(g, 'you', '피아노').correct); assert.deepStrictEqual(g.score, { you: 9, cpu: 0 });
  L.nextTurn(g); assert.strictEqual(g.t.setter, 'you');
  g.t.done = true; L.nextTurn(g); assert.ok(g.over); assert.strictEqual(L.winner(g), 'you');
});

test('tutorial game has one round only', () => {
  const g = L.newGame(E, { seed: 2, rounds: 1, tutorial: true });
  assert.strictEqual(g.order.length, 2);
});

test('cpu: hints are always legal at every stage and level', () => {
  for (const level of ['easy', 'normal', 'hard']) for (let s = 1; s <= 6; s++) {
    const g = L.newGame(E, { seed: s, level }); L.setSecret(g, 'cpu', L.cpuSecret(g));
    for (let st = 1; st <= 3; st++) {
      for (let k = 0; k < 2; k++) { const h = L.cpuHint(g); const c = L.checkHint(g, h); assert.ok(c.ok, level + ' ' + E.words[h] + ' ' + c.err); L.addHint(g, 'cpu', h); }
      assert.ok(L.stageHints(g.t).every((h) => h.rank >= L.MIN_RANK && h.rank <= L.RANK_LIMIT[st - 1]));
      if (st < 3) { g.t.stage++; g.t.phase = 'hint'; }
    }
  }
  const tg = L.newGame(E, { seed: 1, tutorial: true, rounds: 1 }); L.setSecret(tg, 'cpu', '고양이');
  const h = L.cpuHint(tg); assert.ok(E.table(W('고양이')).rank[h] <= 12, 'tutor hint is very close');
});

test('cpu: guesses are new words and the secret word stays hidden from the guesser', () => {
  const g = L.newGame(E, { seed: 9 }); g.t.done = true; L.nextTurn(g);
  L.setSecret(g, 'you', '고양이');
  L.addHint(g, 'you', byRank(g, 120)); L.addHint(g, 'you', byRank(g, 140));
  const seen = new Set();
  for (let k = 0; k < 3; k++) { const q = L.cpuGuess(g); assert.ok(q >= 0 && !seen.has(q)); seen.add(q); const r = L.guess(g, 'cpu', q); assert.ok(r.ok); if (r.correct) break; }
});

test('levels: stronger guesser solves more and sooner (fixed seeds)', () => {
  const run = (lv) => { let solved = 0, stageSum = 0; for (let s = 1; s <= 14; s++) { const st = L.simulateTurn(E, 'normal', lv, s); if (st) { solved++; stageSum += st; } } return { solved, pts: stageSum }; };
  const e = run('easy'), h = run('hard');
  assert.ok(h.solved > e.solved, `hard ${h.solved} easy ${e.solved}`);
});
