'use strict';
// tools/assoc/*.txt (정답: 연상 단어들, 가까운 순) → public/data/assoc.json
// 사전에 없는 단어, 정답 자체, 겹친 단어는 뺀다. 실행: node tools/build_assoc.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'public', 'data');
const vocab = new Set(fs.readFileSync(path.join(dir, 'words.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]));
const out = {}; let n = 0, dropped = 0;
for (const f of fs.readdirSync(path.join(__dirname, 'assoc')).sort()) {
  for (const line of fs.readFileSync(path.join(__dirname, 'assoc', f), 'utf8').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const i = line.indexOf(':'), key = line.slice(0, i).trim();
    const seen = new Set(), list = [];
    for (const w of line.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean)) {
      if (seen.has(w) || w === key || !vocab.has(w)) { dropped++; continue; }
      seen.add(w); list.push(w);
    }
    out[key] = list; n += list.length;
  }
}
fs.writeFileSync(path.join(dir, 'assoc.json'), JSON.stringify(out));
console.log('answers', Object.keys(out).length, 'words', n, 'dropped', dropped);
