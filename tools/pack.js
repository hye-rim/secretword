// 게임용 자료: data/words.txt (단어\t표시: 2=정답 후보, 1=컴퓨터가 힌트로 씀, 0=맞히기만) + data/vecs.bin (int8, 단어마다 100개)
const fs=require('fs');const out=process.argv[2];
const W=fs.readFileSync('ft/v.words.txt','utf8').split('\n');const Q=fs.readFileSync('ft/v.q100.i8');
const DROP=new Set('말 소 비 배 달 별 기타 시 칼 총 은 금 신 용 풀 발 피 약 지도 사전 성 탑 벌 기자 눈 시장 다리 손 꿈 보물'.split(' '));
const ans=new Set(fs.readFileSync('ft/ans1.txt','utf8').trim().split('\n').filter(w=>!DROP.has(w)&&w.length>=2)); // 한 글자 단어는 뜻이 여러 갈래라 정답에서 뺀다
const hint=new Set(fs.readFileSync('ft/hintable.txt','utf8').trim().split('\n'));
fs.writeFileSync(out+'/words.txt',W.map(w=>w+'\t'+(ans.has(w)?2:hint.has(w)?1:0)).join('\n')+'\n');
fs.writeFileSync(out+'/vecs.bin',Q);
console.log('words',W.length,'answers',ans.size,'hint',W.filter(w=>hint.has(w)).length,'bytes',Q.length);
