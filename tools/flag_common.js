'use strict';
// words.txt 의 표시를 다시 매긴다: 2 = 정답 후보(그대로), 1 = 자주 쓰이는 낱말(컴퓨터 힌트·추측 후보), 0 = 나머지(사람만 씀)
// 자주 쓰이는 낱말: tools/common_words.txt (위키낱말사전 「부록:자주 쓰이는 한국어 낱말 5800」, 국립국어연구원 2004 한국어 학습용 어휘에서 고유명사를 뺀 것, CC BY-SA)
// 실행: node tools/flag_common.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'public', 'data');
const common = new Set(fs.readFileSync(path.join(__dirname, 'common_words.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const lines = fs.readFileSync(path.join(dir, 'words.txt'), 'utf8').split('\n').filter(Boolean);
let n = 0;
const out = lines.map((l) => { const [w, f] = l.split('\t'); const g = f === '2' ? 2 : common.has(w) && w.length >= 2 ? 1 : 0; if (g === 1) n++; return w + '\t' + g; });
fs.writeFileSync(path.join(dir, 'words.txt'), out.join('\n') + '\n');
console.log('common hint words', n, 'of', lines.length);
