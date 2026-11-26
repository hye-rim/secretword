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
const low = (g) => near(g, 200);
// 힌트 단계를 끝낸다(10개를 채우거나 95% 이상이 나올 때까지 낮은 힌트)
const finishHints = (g, side = g.t.setter) => { let k = 0; while (g.t.phase === 'hint' && k < 12) { assert.ok(L.addHint(g, side, near(g, 200 + k * 40)).ok); k++; } };

test('engine: absolute score scale follows human-like similarity', () => {
  assert.ok(E.N > 15000 && E.answers.length >= 240 && E.dim === 192);
  const sc = (a, b) => E.table(W(a)).score(W(b));
  assert.strictEqual(sc('고양이', '고양이'), 100);
  assert.ok(sc('휴대폰', '핸드폰') >= 90, 'near synonyms are very high');
  assert.ok(sc('기차', '열차') > sc('바나나', '코코넛'));
  assert.ok(sc('바나나', '코코넛') > 55 && sc('바나나', '코코넛') < 85, 'related fruits are fairly high, not 99');
  assert.ok(sc('바나나', '코코넛') > sc('바나나', '세금'));
  assert.ok(sc('고양이', '세금') < 35, 'unrelated words are low');
  const tb = E.table(W('바나나'));
  assert.ok(['코코넛', '파인애플', '오렌지', '망고', '과일', '아몬드'].some((w) => tb.rank[W(w)] <= 10), 'fruit neighbours, not sound-alikes');
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

test('hints: refused words, a 95 hint ends at once, otherwise the 10th hint ends the stage', () => {
  const g = gameWith('바다');
  assert.strictEqual(L.addHint(g, 'cpu', '없는낱말이다').err, 'unknown');
  assert.strictEqual(L.addHint(g, 'cpu', '바다').err, 'secret');
  if (W('바다낚시') >= 0) assert.strictEqual(L.checkHint(g, '바다낚시').err, 'contains');
  const l = low(g);
  const r = L.addHint(g, 'cpu', l);
  assert.ok(r.ok && r.sim < 95 && !r.guessNow);
  assert.strictEqual(L.addHint(g, 'cpu', l).err, 'used');
  assert.strictEqual(L.guess(g, 'you', '바다').err, 'turn', 'no guessing during hints');
  for (let k = 2; k <= 9; k++) { assert.ok(!L.addHint(g, 'cpu', near(g, 300 + k * 30)).guessNow); }
  assert.strictEqual(L.stageHints(g.t).length, 9); assert.strictEqual(g.t.phase, 'hint');
  assert.ok(L.addHint(g, 'cpu', near(g, 700)).guessNow, 'the 10th hint ends the stage');
  assert.strictEqual(g.t.phase, 'guess');
  const g2 = gameWith('휴대폰');
  const p = L.addHint(g2, 'cpu', '핸드폰');
  assert.ok(p.pass && p.guessNow && p.sim >= 95, 'a 95 hint ends the stage at once');
});

test('guesses: only right or wrong, piece gives one more, pass ends the stage', () => {
  const g = gameWith('기차');
  finishHints(g);
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
  finishHints(g);
  L.guess(g, 'you', '음악');
  assert.strictEqual(g.t.phase, 'extra');
  assert.ok(L.passExtra(g, 'you').nextStage);
  assert.deepStrictEqual(g.score, { you: 0, cpu: 3 }, 'setter gets 2 more for stage 2');
});

test('score: correct guess gives 1, three failed stages give the setter 1+2+3, round 2 doubles', () => {
  const g = gameWith('기차');
  finishHints(g);
  const r = L.guess(g, 'you', '기차');
  assert.ok(r.correct && r.turnOver);
  assert.deepStrictEqual(g.score, { you: 1, cpu: 0 });
  assert.strictEqual(g.history[0].solved, true);
  // 내가 출제, 컴퓨터가 끝까지 못 맞힘(피스 없음)
  L.nextTurn(g); g.pieces.cpu = 0;
  assert.ok(L.setSecret(g, 'you', g.deck.you[0]).ok);
  for (let st = 1; st <= 3; st++) {
    finishHints(g);
    const w = E.answers.find((i) => i !== g.t.secret && !g.t.hints.some((h) => h.i === i) && !g.t.guesses.some((h) => h.i === i));
    assert.ok(L.guess(g, 'cpu', w).ok);
  }
  assert.ok(g.t.done && !g.t.solved);
  assert.deepStrictEqual(g.score, { you: 7, cpu: 0 });
  // 2라운드: 1단계에 맞히면 2점
  L.nextTurn(g); assert.strictEqual(g.t.round, 2);
  L.setSecret(g, 'cpu', g.deck.cpu[0]);
  finishHints(g);
  L.guess(g, 'you', E.words[g.t.secret]);
  assert.deepStrictEqual(g.score, { you: 9, cpu: 0 });
  L.nextTurn(g); g.t.done = true; L.nextTurn(g);
  assert.ok(g.over); assert.strictEqual(L.winner(g), 'you');
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
      assert.ok(hs.length === L.MAX_HINTS || hs[hs.length - 1].sim >= 95, 'stage ends by 10 hints or a 95 hint');
      assert.ok(hs.slice(0, -1).every((h) => h.sim < 95), 'earlier hints are below 95');
      if (st < 3) { assert.ok(L.guess(g, 'you', ['우주', '전쟁'][st - 1]).nextStage || g.t.done); }
    }
  }
});

test('cpu: guesses are new words, never a hint', () => {
  const g = L.newGame(E, { seed: 9 }); g.t.done = true; L.nextTurn(g);
  L.setSecret(g, 'you', g.deck.you[0]);
  finishHints(g);
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
