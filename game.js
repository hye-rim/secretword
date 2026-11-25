'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 숨은 단어: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_SW)
(() => {
const L = LOGIC_SW;
const $ = (id) => document.getElementById(id);
const TUT = /[?&]tutorial=1/.test(location.search);
const REC_KEY = 'secretwordRec', WINS_KEY = 'secretwordWins', MUTE_KEY = 'secretwordMuted';
const LEVELS = [{ id: 'easy', name: '쉬움', desc: '가까운 힌트를 주고, 잘 못 맞혀요' }, { id: 'normal', name: '보통', desc: '적당한 힌트, 적당한 눈치' }, { id: 'hard', name: '어려움', desc: '헷갈리는 힌트를 주고, 잘 맞혀요' }];
const TUT_SECRET = '고양이';
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
let rec = (() => { try { const o = JSON.parse(store.get(REC_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } })();
let muted = store.get(MUTE_KEY) === '1';
const saveRec = () => { store.set(REC_KEY, JSON.stringify(rec)); store.set(WINS_KEY, String(Object.values(rec).reduce((a, r) => a + (r.w || 0), 0))); };

// ---------- 소리 ----------
let audio = null;
function tone(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), gn = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = { hint: () => tone(520, 0.08, 'triangle', 0.07, 120), guess: () => tone(380, 0.08, 'triangle', 0.08, -60), bad: () => tone(160, 0.14, 'square', 0.06), pick: () => tone(640, 0.05, 'sine', 0.06), solve: () => seq([523, 659, 784, 1046], 110), miss: () => seq([392, 330], 140, 'sawtooth', 0.06), win: () => seq([523, 659, 784, 1046, 1318], 120), lose: () => seq([392, 330, 262], 150, 'sawtooth', 0.07), draw: () => seq([440, 440], 160) };

// ---------- 상태 ----------
let E = null, g = null, level = 'normal', phase = 'loading', fresh = null, picks = [], timers = [], pendingSend = false;
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const setMsg = (t) => { $('msg').innerHTML = t; };
const W = (i) => E.words[i];
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); }; // 받침에 맞는 조사
const rankText = (r) => (r <= 1000 ? r + '위' : '1000위 밖');
const myGuess = () => phase === 'play' && g.t && !g.t.done && g.t.guesser === 'you' && g.t.phase === 'guess';
const myHint = () => phase === 'play' && g.t && !g.t.done && g.t.setter === 'you' && g.t.phase === 'hint';
const ERR = {
  unknown: '사전에 없는 단어예요. <b>명사</b>를 띄어쓰기 없이 써요.',
  secret: '숨긴 단어 자체는 힌트로 못 써요.',
  contains: '숨긴 단어와 <b>글자가 겹치는</b> 단어는 힌트로 못 써요.',
  used: '이미 나온 단어예요.',
};

function startGame(lv) {
  if (!E) return;
  clearTimers(); level = lv; fresh = null;
  g = L.newGame(E, { seed: TUT ? 7 : (Date.now() % 99991) + 1, level: lv, rounds: TUT ? 1 : 2, tutorial: TUT });
  phase = 'play'; $('overlay').classList.add('hidden');
  beginTurn();
}

function beginTurn() {
  const t = g.t; fresh = null; $('nextBtn').classList.add('hidden');
  if (t.setter === 'cpu') {
    L.setSecret(g, 'cpu', TUT ? TUT_SECRET : L.cpuSecret(g));
    setMsg('컴퓨터가 단어를 숨겼어요. <b>힌트</b>를 보고 맞혀요!');
    render(); later(cpuHints, 700);
  } else {
    rollPicks();
    setMsg('이번엔 내가 출제자! 아래에서 <b>숨길 단어</b>를 골라요.');
    render();
  }
}
function rollPicks() {
  const used = new Set(g.history.map((h) => h.secret));
  const pool = E.answers.filter((i) => !used.has(i) && !picks.includes(i));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  picks = pool.slice(0, 5);
}
function chooseSecret(i) {
  if (phase !== 'play' || !g.t || g.t.setter !== 'you' || g.t.phase !== 'secret') return;
  const r = L.setSecret(g, 'you', i); if (!r.ok) return;
  sfx.pick(); tutorialSignal('secret');
  setMsg('<b>' + josa(W(i), '</b>을', '</b>를') + ' 숨겼어요. 이제 힌트를 내요. 정답과 <b>가까운 단어</b>여야 해요(💡 는 추천).');
  render(); focusInput();
}

// 컴퓨터 힌트: 단계마다 2개
function cpuHints() {
  if (phase !== 'play' || !g.t || g.t.setter !== 'cpu' || g.t.phase !== 'hint') return;
  const h = L.cpuHint(g);
  if (h < 0) { setMsg('힌트를 고르지 못했어요.'); return; }
  L.addHint(g, 'cpu', h); fresh = { kind: 'hint', i: h }; sfx.hint();
  render();
  if (g.t.phase === 'hint') later(cpuHints, 800);
  else { setMsg(stageMsgGuess()); focusInput(); }
}
function stageMsgGuess() {
  const t = g.t, left = L.GUESSES_PER_STAGE - L.stageGuesses(t).length;
  return t.stage + '단계 힌트가 나왔어요. 정답이라고 생각하는 단어를 <b>' + left + '번</b> 낼 수 있어요.';
}
// 컴퓨터 맞히기: 한 번에 하나씩
function cpuGuesses() {
  if (phase !== 'play' || !g.t || g.t.guesser !== 'cpu' || g.t.phase !== 'guess') return;
  const q = L.cpuGuess(g); const r = L.guess(g, 'cpu', q);
  fresh = { kind: 'guess', i: q }; render();
  if (r.correct) { sfx.miss(); return reveal(); }
  sfx.guess();
  if (r.turnOver) { sfx.solve(); return reveal(); }
  if (r.nextStage) { setMsg('컴퓨터가 못 맞혔어요! <b>' + g.t.stage + '단계</b> 힌트를 내요. 이번엔 <b>' + L.RANK_LIMIT[g.t.stage - 1] + '위 안</b>이어야 해요.'); render(); focusInput(); return; }
  later(cpuGuesses, 950);
}

function send() {
  pendingSend = false;
  const inp = $('word'), text = inp.value.trim();
  if (!text) return;
  if (myGuess()) {
    const r = L.guess(g, 'you', text);
    if (!r.ok) { sfx.bad(); setMsg(ERR[r.err] || '지금은 낼 수 없어요.'); return; }
    inp.value = ''; const last = g.t.guesses[g.t.guesses.length - 1]; fresh = { kind: 'guess', i: last.i };
    tutorialSignal('guess');
    if (r.correct) { sfx.solve(); tutorialSignal('solve'); render(); return reveal(); }
    sfx.guess();
    if (r.turnOver) { sfx.miss(); render(); return reveal(); }
    if (r.nextStage) { setMsg('아쉬워요! 컴퓨터가 <b>' + g.t.stage + '단계</b> 힌트(더 가까운 단어)를 내요…'); render(); later(cpuHints, 900); return; }
    setMsg('<b>' + last.word + '</b>: 유사도 ' + L.pct(r.sim).toFixed(2) + ' · ' + rankText(r.rank) + '. 이번 단계에 답을 <b>' + (L.GUESSES_PER_STAGE - L.stageGuesses(g.t).length) + '번</b> 더 낼 수 있어요.');
    render(); return;
  }
  if (myHint()) {
    const r = L.addHint(g, 'you', text);
    if (!r.ok) {
      sfx.bad();
      if (r.err === 'close') setMsg('<b>' + text + '</b>: ' + r.rank + '위, 너무 가까워요. ' + L.MIN_RANK + '위부터 쓸 수 있어요.');
      else if (r.err === 'far') setMsg('<b>' + text + '</b>: ' + rankText(r.rank) + ', 너무 멀어요. 이번 단계는 <b>' + r.limit + '위 안</b>이어야 해요. (💡 추천)');
      else setMsg(ERR[r.err] || '지금은 낼 수 없어요.');
      return;
    }
    inp.value = ''; const last = g.t.hints[g.t.hints.length - 1]; fresh = { kind: 'hint', i: last.i };
    sfx.hint(); tutorialSignal('hint');
    if (g.t.phase === 'guess') { setMsg('힌트를 다 냈어요. 컴퓨터가 맞혀요…'); render(); later(cpuGuesses, 900); return; }
    setMsg('좋아요(' + r.rank + '위). 힌트를 <b>하나 더</b> 내요.'); render(); focusInput(); return;
  }
}
function suggest() {
  if (!myHint()) return;
  const lv = g.level; g.level = 'normal'; const h = L.cpuHint(g); g.level = lv;
  if (h < 0) return;
  $('word').value = W(h); sfx.pick();
  setMsg('추천: <b>' + W(h) + '</b> (' + E.table(g.t.secret).rank[h] + '위). <b>힌트 내기</b>를 누르면 내요.');
}

function reveal() {
  const t = g.t, res = t.result, secret = W(t.secret);
  tutorialSignal('reveal');
  if (res.who === 'you') setMsg(t.setter === 'you' ? '컴퓨터가 끝까지 못 맞혔어요! 출제 점수 <b>+' + res.pts + '</b>' : '정답 <b>' + secret + '</b>! ' + t.stage + '단계에 맞혀서 <b>+' + res.pts + '</b>점');
  else setMsg(t.setter === 'cpu' ? '정답은 <b>' + josa(secret, '</b>이었어요', '</b>였어요') + '. 컴퓨터 출제 점수 +' + res.pts : '컴퓨터가 ' + t.stage + '단계에 <b>' + josa(secret, '</b>을', '</b>를') + ' 맞혔어요. 컴퓨터 +' + res.pts);
  render();
  $('nextBtn').textContent = g.ti + 1 >= g.order.length ? '결과 보기 ▶' : '다음 차례 ▶';
  $('nextBtn').classList.remove('hidden');
}
function nextTurn() {
  if (phase !== 'play' || !g.t || !g.t.done) return;
  tutorialSignal('next');
  L.nextTurn(g);
  if (g.over) return end();
  beginTurn();
}

function focusInput() { if (!matchMedia('(pointer:coarse)').matches) setTimeout(() => { try { $('word').focus(); } catch (_) {} }, 0); }

function row(kind, who, h) {
  const d = document.createElement('div');
  d.className = 'row ' + kind + (h.correct ? ' correct' : '') + (fresh && fresh.kind === kind && fresh.i === h.i ? ' fresh' : '');
  const bar = Math.max(0, Math.min(1, h.sim / 0.7));
  d.innerHTML = '<span class="bar" style="width:' + (bar * 100).toFixed(0) + '%"></span><span class="who">' + who + '</span><span class="w"></span>' +
    (h.correct ? '<span class="s">정답!</span><span class="r">🎉</span>' : '<span class="s">' + L.pct(h.sim).toFixed(2) + '</span><span class="r">' + rankText(h.rank) + '</span>');
  d.querySelector('.w').textContent = h.word;
  return d;
}
function render() {
  if (!g) return;
  const t = g.t;
  $('scoreText').textContent = '나 ' + g.score.you + ' : ' + g.score.cpu + ' 컴';
  $('lvLabel').textContent = TUT ? '연습' : (LEVELS.find((l) => l.id === level) || {}).name || '';
  $('roundLabel').textContent = t ? t.round + '라운드' + (t.round === 2 ? '(×2)' : '') : '';
  // 기록
  const log = $('log'); log.innerHTML = '';
  if (t && t.secret >= 0) {
    for (let st = 1; st <= t.stage; st++) {
      const hs = t.hints.filter((h) => h.stage === st), gs = t.guesses.filter((h) => h.stage === st);
      if (!hs.length && !gs.length) continue;
      const head = document.createElement('div'); head.className = 'stageHead';
      head.innerHTML = '<span>' + st + '단계 힌트 (' + L.RANK_LIMIT[st - 1] + '위 안)</span><span>유사도 · 순위</span>'; log.appendChild(head);
      hs.forEach((h) => log.appendChild(row('hint', '힌트', h)));
      gs.forEach((h) => log.appendChild(row('guess', t.guesser === 'you' ? '나' : '컴', h)));
    }
  }
  if (!log.children.length) {
    const e = document.createElement('div'); e.id = 'logEmpty';
    e.innerHTML = t && t.setter === 'you' && t.phase === 'secret' ? '숨길 단어를 고르면<br>힌트와 답이 여기에 쌓여요' : t && t.setter === 'you' ? '숨긴 단어와 가까운 단어를<br>아래에 써서 힌트로 내요' : '힌트를 기다려요…';
    log.appendChild(e);
  }
  log.scrollTop = log.scrollHeight;
  // 배너
  let main = '', sub = '';
  if (phase === 'play' && t) {
    if (t.setter === 'cpu') {
      main = t.done ? '정답은 <b>' + W(t.secret) + '</b>' : '컴퓨터 출제 · <b>' + t.stage + '단계</b>';
      sub = t.done ? '' : t.phase === 'guess' ? '남은 답 ' + (L.GUESSES_PER_STAGE - L.stageGuesses(t).length) + '번 · 맞히면 ' + L.GUESS_PTS[t.stage - 1] * t.round + '점' : '힌트를 내는 중…';
    } else {
      main = t.phase === 'secret' ? '내 출제 · 숨길 단어 고르기' : '내 출제 · <b>' + t.stage + '단계</b> <span id="secretTag">' + W(t.secret) + '</span>';
      sub = t.done ? '' : t.phase === 'hint' ? '힌트 ' + (L.HINTS_PER_STAGE - L.stageHints(t).length) + '개 더 · ' + L.MIN_RANK + '~' + L.RANK_LIMIT[t.stage - 1] + '위 단어' : t.phase === 'guess' ? '컴퓨터가 맞히는 중…' : '';
    }
  }
  $('bannerText').innerHTML = main; $('bannerSub').textContent = sub;
  // 고르기·입력
  const pickOn = phase === 'play' && t && t.setter === 'you' && t.phase === 'secret';
  $('pickBox').classList.toggle('hidden', !pickOn);
  if (pickOn) {
    const pb = $('pickBox'); pb.innerHTML = '';
    picks.forEach((i) => { const b = document.createElement('button'); b.textContent = W(i); b.onclick = () => chooseSecret(i); pb.appendChild(b); });
    const re = document.createElement('button'); re.className = 're'; re.textContent = '🔄 다른 단어'; re.onclick = () => { sfx.pick(); rollPicks(); render(); }; pb.appendChild(re);
  }
  const inOn = myGuess() || myHint() || (phase === 'play' && t && !t.done && t.secret >= 0);
  $('inputRow').classList.toggle('hidden', !inOn);
  $('sendBtn').textContent = t && t.setter === 'you' ? '힌트 내기' : '맞히기';
  $('sendBtn').disabled = !(myGuess() || myHint());
  $('word').disabled = !(myGuess() || myHint());
  $('word').placeholder = myHint() ? '힌트 단어' : myGuess() ? '정답일 것 같은 단어' : '기다려요…';
  $('suggestBtn').style.display = t && t.setter === 'you' ? '' : 'none';
  $('suggestBtn').disabled = !myHint();
}

function end() {
  phase = 'over'; clearTimers(); $('nextBtn').classList.add('hidden'); $('inputRow').classList.add('hidden');
  const w = L.winner(g), r = rec[level] = rec[level] || { w: 0, l: 0, d: 0 };
  if (!TUT) { if (w === 'you') r.w++; else if (w === 'cpu') r.l++; else r.d++; saveRec(); }
  w === 'you' ? sfx.win() : w === 'cpu' ? sfx.lose() : sfx.draw();
  tutorialSignal('over');
  const rows = g.history.map((h) => '<tr><td>' + h.round + 'R</td><td>' + (h.setter === 'you' ? '내 출제' : '컴 출제') + '</td><td><b>' + h.word + '</b></td><td>' + (h.who === h.setter ? '못 맞힘' : h.stage + '단계 정답') + '</td><td>' + (h.who === 'you' ? '나' : '컴') + ' +' + h.pts + '</td></tr>').join('');
  const ov = $('overlay'); ov.classList.remove('hidden');
  ov.innerHTML = '<h1>' + (w === 'you' ? '🎉 승리!' : w === 'cpu' ? '😢 패배' : '🤝 무승부') + '</h1><h2>' + g.score.you + ' : ' + g.score.cpu + '</h2><table>' + rows + '</table>' +
    '<div class="col"><button id="againBtn">한 판 더</button><button class="sub" id="seeBtn">기록 다시 보기</button><button class="sub" id="titleBtn">처음으로</button></div>';
  $('againBtn').onclick = () => startGame(level); $('titleBtn').onclick = showTitle; $('seeBtn').onclick = () => ov.classList.add('hidden');
  render(); $('bannerText').innerHTML = w === 'you' ? '🎉 내가 이겼어요' : w === 'cpu' ? '😢 컴퓨터가 이겼어요' : '🤝 비겼어요'; $('bannerSub').textContent = '나 ' + g.score.you + ' : ' + g.score.cpu + ' 컴퓨터';
}

function rulesHtml() {
  return '<p>출제자는 단어 하나를 <b>숨기고</b>, 그 단어와 <b>뜻이 가까운 단어</b>를 힌트로 내요. 단어마다 숨긴 단어와의 <b>유사도</b>(AI 단어 벡터)와 <b>순위</b>(1위 = 가장 가까운 단어)가 보여요.<br>' +
    '한 단계에 힌트 <b>' + L.HINTS_PER_STAGE + '개</b> → 상대가 답 <b>' + L.GUESSES_PER_STAGE + '번</b>. 단계가 갈수록 힌트가 가까워야 해요(' + L.RANK_LIMIT.join('위 → ') + '위 안, 1~3위는 금지).<br>' +
    '1·2·3단계에 맞히면 <b>' + L.GUESS_PTS.join('·') + '점</b>, 끝까지 못 맞히면 출제자 <b>' + L.SETTER_PTS + '점</b>. 컴퓨터와 번갈아 출제하고, <b>2라운드는 점수 2배</b>!</p>';
}
function showTitle() {
  clearTimers(); phase = E ? 'title' : 'loading';
  const ov = $('overlay'); ov.classList.remove('hidden');
  const credit = '<p class="credit">유사도: fastText 한국어 단어 벡터 (Facebook, CC BY-SA 3.0) 를 줄여 씀</p>';
  if (!E) { ov.innerHTML = '<h1>🔎 숨은 단어</h1><p id="loadMsg">단어 사전을 불러오는 중… (약 2MB)</p>'; return; }
  if (TUT) { ov.innerHTML = '<h1>🔎 숨은 단어</h1>' + rulesHtml() + '<div class="col"><button id="b1">시작하기</button></div>' + credit; $('b1').onclick = () => startGame('easy'); return; }
  ov.innerHTML = '<h1>🔎 숨은 단어</h1>' + rulesHtml() +
    '<div class="col" id="lv">' + LEVELS.map((l) => '<button data-lv="' + l.id + '">' + l.name + '<small>' + l.desc + (rec[l.id] ? ' · ' + (rec[l.id].w || 0) + '승 ' + (rec[l.id].l || 0) + '패' : '') + '</small></button>').join('') + '</div>' + credit;
  ov.querySelectorAll('#lv button').forEach((b) => { b.onclick = () => startGame(b.dataset.lv); });
}

$('sendBtn').onclick = send;
$('suggestBtn').onclick = suggest;
$('nextBtn').onclick = nextTurn;
$('word').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.isComposing || e.keyCode === 229) { pendingSend = true; return; } // 한글 조합 중: 조합이 끝나면 보낸다
  send();
});
$('word').addEventListener('compositionend', () => { if (pendingSend) setTimeout(send, 0); });
$('homeBtn').onclick = showTitle;
$('muteBtn').onclick = () => { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('keydown', (e) => { if (e.target === $('word')) return; if (e.key === 'm' || e.key === 'M') $('muteBtn').click(); else if (e.key === 'Enter' && !$('nextBtn').classList.contains('hidden')) nextTurn(); });
/* @test-hooks:start */
window.__sw = { get g() { return g; }, get E() { return E; }, get phase() { return phase; }, startGame, render, send, nextTurn };
/* @test-hooks:end */

showTitle();
Promise.all([fetch('data/words.txt').then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }), fetch('data/vecs.bin').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })])
  .then(([txt, buf]) => { E = L.makeEngine(txt, new Int8Array(buf)); if (phase === 'loading') showTitle(); })
  .catch(() => { const m = $('loadMsg'); if (m) m.textContent = '단어 사전을 불러오지 못했어요. 새로고침해 주세요.'; });
})();
