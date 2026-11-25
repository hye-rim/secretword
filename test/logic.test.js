'use strict';

// 숨은 단어 규칙·컴퓨터 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../public/logic.js');

const dir = path.join(__dirname, '..', 'public', 'data');
const E = L.makeEngine(fs.readFileSync(path.join(dir, 'words.txt'), 'utf8'), new Int8Array(fs.readFileSync(path.join(dir, 'vecs.bin'))), new Float32Array(fs.readFileSync(path.join(dir, 'anchors.bin')).buffer.slice(0)));
const W = (w) => E.find(w);
const A = (w) => E.answers.filter((i) => E.words[i] !== w);

// 정답 후보를 정해 둔 판 (컴퓨터 출제 차례에서 시작)
function gameWith(cpuSecret, opts = {}) {
  const decks = { cpu: [W(cpuSecret)].concat(A(cpuSecret).slice(0, 4)), you: A(cpuSecret).slice(10, 15) };
  const g = L.newGame(E, Object.assign({ seed: 3, decks }, opts));
  assert.ok(L.setSecret(g, 'cpu', cpuSecret).ok);
  return g;
}
// 숨긴 단어와 글자가 겹치지 않고 아직 안 쓴, 순위 r 근처의 단어
const near = (g, r) => { const tb = E.table(g.t.secret); for (let k = r - 1; k < tb.order.length; k++) { const c = L.checkHint(g, tb.order[k]); if (c.ok) return E.words[tb.order[k]]; } return null; };
const pass95 = (g) => near(g, 1);
const low = (g) => near(g, 200);

test('engine: score scale puts rank 10 at exactly 95 and rank 1 at 99.99', () => {
  assert.ok(E.N > 15000 && E.answers.length >= 240);
  const s = W('고양이'), tb = E.table(s);
  assert.strictEqual(tb.score(tb.order[0]).toFixed(2), '99.99');
  assert.strictEqual(tb.score(tb.order[9]).toFixed(2), '95.00');
  assert.ok(tb.score(tb.order[10]) < 95);
  for (let r = 0; r < 3000; r += 37) assert.ok(tb.score(tb.order[r]) >= tb.score(tb.order[r + 37]));
  assert.ok(tb.score(W('강아지')) >= 95);
  assert.ok(tb.score(W('세금')) < 60);
  assert.ok(Math.abs(E.anchors[s * 2 + 1] - tb.c10) < 1e-6, 'precomputed anchor matches');
});

test('decks: five words each, no overlap, round 2 picks from the remaining four', () => {
  const g = L.newGame(E, { seed: 5 });
  assert.strictEqual(g.deck.cpu.length, 5); assert.strictEqual(g.deck.you.length, 5);
  assert.ok(g.deck.cpu.every((i) => !g.deck.you.includes(i)));
  assert.strictEqual(L.setSecret(g, 'cpu', g.deck.you[0]).err, 'notInDeck');
  assert.strictEqual(L.setSecret(g, 'you', g.deck.you[0]).err, 'turn');
  const pick = g.deck.cpu[2];
  assert.ok(L.setSecret(g, 'cpu', pick).ok);
  assert.strictEqual(g.deck.cpu.length, 4);
  assert.ok(!g.deck.cpu.includes(pick));
});

test('hints: refused words, low hints keep going, a 95 hint ends the hint stage', () => {
  const g = gameWith('바다');
  assert.strictEqual(L.addHint(g, 'cpu', '없는낱말이다').err, 'unknown');
  assert.strictEqual(L.addHint(g, 'cpu', '바다').err, 'secret');
  if (W('바다낚시') >= 0) assert.strictEqual(L.checkHint(g, '바다낚시').err, 'contains');
  const l = low(g);
  const r = L.addHint(g, 'cpu', l);
  assert.ok(r.ok && r.sim < 95 && !r.guessNow);
  assert.strictEqual(g.t.phase, 'hint');
  assert.strictEqual(L.addHint(g, 'cpu', l).err, 'used');
  assert.strictEqual(L.guess(g, 'you', '바다').err, 'turn', 'no guessing before a 95 hint');
  for (let k = 0; k < 6; k++) { L.addHint(g, 'cpu', near(g, 300 + k * 50)); assert.strictEqual(g.t.phase, 'hint', 'still must give hints'); }
  const p = L.addHint(g, 'cpu', pass95(g));
  assert.ok(p.pass && p.guessNow && p.sim >= 95);
  assert.strictEqual(g.t.phase, 'guess');
});

test('guesses: only right or wrong, piece gives one more, pass ends the stage', () => {
  const g = gameWith('기차');
  L.addHint(g, 'cpu', pass95(g));
  const hintWord = g.t.hints[0].word;
  assert.strictEqual(L.guess(g, 'you', hintWord).err, 'isHint');
  assert.strictEqual(L.guess(g, 'cpu', '버스').err, 'turn');
  const r = L.guess(g, 'you', '사과');
  assert.deepStrictEqual(Object.keys(r).sort(), ['canPiece', 'correct', 'ok'], 'no similarity in a guess result');
  assert.ok(!('sim' in g.t.guesses[0]) && !('rank' in g.t.guesses[0]));
  assert.strictEqual(g.t.phase, 'extra');
  assert.ok(L.usePiece(g, 'you').ok);
  assert.strictEqual(g.pieces.you, L.PIECES - 1);
  assert.strictEqual(g.t.phase, 'guess');
  assert.strictEqual(L.guess(g, 'you', '사과').err, 'used');
  const r2 = L.guess(g, 'you', '바다');
  assert.ok(r2.nextStage, 'second wrong answer ends the stage');
  assert.strictEqual(g.t.stage, 2); assert.strictEqual(g.t.phase, 'hint');
  assert.deepStrictEqual(g.score, { you: 0, cpu: 1 }, 'setter gets 1 for stage 1');
  L.addHint(g, 'cpu', pass95(g));
  L.guess(g, 'you', '음악');
  assert.strictEqual(g.t.phase, 'extra');
  assert.ok(L.passExtra(g, 'you').nextStage);
  assert.deepStrictEqual(g.score, { you: 0, cpu: 3 }, 'setter gets 2 more for stage 2');
});

test('score: correct guess gives 1, three failed stages give the setter 1+2+3, round 2 doubles', () => {
  const g = gameWith('기차');
  L.addHint(g, 'cpu', pass95(g));
  const r = L.guess(g, 'you', '기차');
  assert.ok(r.correct && r.turnOver);
  assert.deepStrictEqual(g.score, { you: 1, cpu: 0 });
  assert.strictEqual(g.history[0].solved, true);
  // 내가 출제, 컴퓨터가 끝까지 못 맞힘(피스 없음)
  L.nextTurn(g); g.pieces.cpu = 0;
  assert.ok(L.setSecret(g, 'you', g.deck.you[0]).ok);
  const wrong = ['우주', '전쟁', '컴퓨터', '선거', '축구'].filter((w) => W(w) !== g.t.secret);
  for (let st = 1; st <= 3; st++) { L.addHint(g, 'you', pass95(g)); assert.ok(L.guess(g, 'cpu', wrong[st - 1]).ok); }
  assert.ok(g.t.done && !g.t.solved);
  assert.deepStrictEqual(g.score, { you: 7, cpu: 0 });
  // 2라운드: 1단계에 맞히면 2점
  L.nextTurn(g); assert.strictEqual(g.t.round, 2);
  L.setSecret(g, 'cpu', g.deck.cpu[0]);
  L.addHint(g, 'cpu', pass95(g));
  L.guess(g, 'you', E.words[g.t.secret]);
  assert.deepStrictEqual(g.score, { you: 9, cpu: 0 });
  L.nextTurn(g); g.t.done = true; L.nextTurn(g);
  assert.ok(g.over); assert.strictEqual(L.winner(g), 'you');
});

test('a stage ends on any hint once no 95 hint is left', () => {
  const g = gameWith('바다');
  const tb = E.table(g.t.secret);
  for (const i of tb.order.slice(0, 10)) g.t.hints.push({ i, word: E.words[i], sim: 99, stage: 0 }); // 95 이상 단어를 다 써 버린 상황
  assert.strictEqual(L.pass95Left(g), false);
  const r = L.addHint(g, 'cpu', low(g));
  assert.ok(r.ok && !r.pass && r.guessNow);
});

test('tutorial game has one round only', () => {
  const g = L.newGame(E, { seed: 2, rounds: 1, tutorial: true });
  assert.strictEqual(g.order.length, 2);
});

test('cpu: every stage of hints is legal and ends with a 95 hint', () => {
  for (const level of ['easy', 'normal', 'hard']) for (let s = 1; s <= 4; s++) {
    const g = L.newGame(E, { seed: s, level }); g.pieces.you = 0; L.setSecret(g, 'cpu', L.cpuSecret(g));
    for (let st = 1; st <= 3; st++) {
      let guard = 0;
      while (g.t.phase === 'hint' && guard++ < 20) { const h = L.cpuHint(g); assert.ok(L.checkHint(g, h).ok, level + ' ' + E.words[h]); L.addHint(g, 'cpu', h); }
      const hs = L.stageHints(g.t);
      assert.ok(hs[hs.length - 1].sim >= 95, 'last hint of the stage passes 95');
      assert.ok(hs.slice(0, -1).every((h) => h.sim < 95), 'earlier hints are below 95');
      if (st < 3) { assert.ok(L.guess(g, 'you', ['우주', '전쟁'][st - 1]).nextStage || g.t.done); }
    }
  }
});

test('cpu: guesses are new words, never a hint', () => {
  const g = L.newGame(E, { seed: 9 }); g.t.done = true; L.nextTurn(g);
  L.setSecret(g, 'you', g.deck.you[0]);
  L.addHint(g, 'you', low(g)); L.addHint(g, 'you', pass95(g));
  const q = L.cpuGuess(g);
  assert.ok(q >= 0 && !g.t.hints.some((h) => h.i === q));
  assert.ok(L.guess(g, 'cpu', q).ok);
  if (g.t.phase === 'extra') { assert.ok(L.usePiece(g, 'cpu').ok); const q2 = L.cpuGuess(g); assert.ok(q2 >= 0 && q2 !== q); }
});

test('levels: stronger guesser solves more (fixed seeds)', () => {
  const run = (lv) => { let solved = 0; for (let s = 1; s <= 16; s++) if (L.simulateTurn(E, 'normal', lv, s).solved) solved++; return solved; };
  const e = run('easy'), h = run('hard');
  assert.ok(h > e, `hard ${h} easy ${e}`);
});
