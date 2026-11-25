'use strict';
// 2단계: 고른 단어들의 벡터를 꺼내 정규화해서 words.txt + vecs.f32 로 저장
// 실행: node vecs.js <vec.gz> <wordlist.txt(한 줄에 한 단어)> <outPrefix>
const fs = require('fs'), zlib = require('zlib'), readline = require('readline');
const [, , src, list, out] = process.argv;
const want = new Set(fs.readFileSync(list, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const words = [], vecs = []; let n = -1;
  for await (const line of rl) {
    if (n++ < 0) continue;
    if (n > 400000 || words.length === want.size) break;
    const sp = line.indexOf(' '), w = line.slice(0, sp);
    if (!want.has(w) || words.includes(w)) continue;
    const v = Float32Array.from(line.slice(sp + 1).trim().split(' ').map(Number));
    let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); for (let i = 0; i < v.length; i++) v[i] /= s;
    words.push(w); vecs.push(v);
  }
  rl.close();
  fs.writeFileSync(out + '.words.txt', words.join('\n'));
  const buf = new Float32Array(words.length * 300); vecs.forEach((v, i) => buf.set(v, i * 300));
  fs.writeFileSync(out + '.f32', Buffer.from(buf.buffer));
  console.log('saved', words.length);
})();
