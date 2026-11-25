'use strict';
// 1단계: fastText 어휘(빈도순) 앞쪽에서 명사 후보를 뽑는다.
// 조사 붙은 꼴(사과를, 사과가, 사과에…)이 어휘에 여러 개 있으면 명사로 본다.
// 실행: node nouns.js <cc.ko.300.vec.gz> <topN> <out.txt>
const fs = require('fs'), zlib = require('zlib'), readline = require('readline');
const [, , src, topArg, out] = process.argv;
const TOP = +topArg || 300000;
const HANGUL = /^[가-힣]+$/;
const hasBatchim = (w) => (w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 0;

(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const words = []; let n = -1;
  for await (const line of rl) {
    if (n++ < 0) continue;
    if (n > TOP) break;
    words.push(line.slice(0, line.indexOf(' ')));
  }
  rl.close();
  const rank = new Map(); words.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });
  const res = [];
  for (const [w, r] of rank) {
    if (!HANGUL.test(w) || w.length > 4) continue;
    const b = hasBatchim(w);
    const vs = b ? ['을', '이', '은', '과', '으로', '에', '의', '도', '에서'] : ['를', '가', '는', '와', '로', '에', '의', '도', '에서'];
    const hit = vs.filter((p) => rank.has(w + p)).length;
    if (hit >= 3) res.push(r + '\t' + w + '\t' + hit);
  }
  fs.writeFileSync(out, res.join('\n') + '\n');
  console.log('vocab', words.length, 'nouns', res.length);
})();
