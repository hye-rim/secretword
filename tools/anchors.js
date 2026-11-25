'use strict';
// 단어마다 '가장 가까운 단어의 코사인(c1)'과 '10번째로 가까운 단어의 코사인(c10)'을 미리 계산해 둔다.
// 유사도 점수 눈금(10위 = 95점)을 정하는 기준이고, 컴퓨터가 정답 후보마다 점수를 예상할 때 쓴다.
// 실행: node tools/anchors.js  (public/data/words.txt, vecs.bin → anchors.bin: 단어마다 Float32 2개)
const fs = require('fs'), path = require('path');
const L = require('../public/logic.js');
const dir = path.join(__dirname, '..', 'public', 'data');
const E = L.makeEngine(fs.readFileSync(path.join(dir, 'words.txt'), 'utf8'), new Int8Array(fs.readFileSync(path.join(dir, 'vecs.bin'))));
const N = E.N, D = L.DIM, V = E.vec;
const top = Array.from({ length: N }, () => new Float32Array(10).fill(-2)); // 내림차순 위 10개
const push = (arr, s) => { if (s <= arr[9]) return; let k = 9; while (k > 0 && arr[k - 1] < s) { arr[k] = arr[k - 1]; k--; } arr[k] = s; };
const t0 = Date.now();
for (let a = 0; a < N; a++) {
  const oa = a * D;
  for (let b = a + 1; b < N; b++) {
    let s = 0; const ob = b * D;
    for (let k = 0; k < D; k++) s += V[oa + k] * V[ob + k];
    push(top[a], s); push(top[b], s);
  }
}
const out = new Float32Array(N * 2);
for (let i = 0; i < N; i++) { out[i * 2] = top[i][0]; out[i * 2 + 1] = top[i][9]; }
fs.writeFileSync(path.join(dir, 'anchors.bin'), Buffer.from(out.buffer));
console.log('anchors', N, 'ms', Date.now() - t0);
