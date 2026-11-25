const fs=require('fs');
const rows=fs.readFileSync('ft/nouns3.txt','utf8').trim().split('\n').map(l=>{const [r,w,h]=l.split('\t');return {r:+r,w,h:+h};});
const ans=fs.readFileSync('ft/ans1.txt','utf8').trim().split('\n');const A=new Set(ans);
const all=new Set(rows.map(x=>x.w));
const P=['에서','에게','으로','까지','부터','처럼','보다','하고','에','로','만','과','와','도','의','을','를','이','가','은','는','들'];
const STOP=new Set('경우 때문 정도 이상 이하 이후 이전 당시 현재 지금 이번 다음 동안 가운데 대부분 일부 전체 모두 자신 우리 저희 여러분 그것 이것 저것 무엇 누구 어디 언제 하지 보기 보고 가지 번째 관련 통해 위해 대해 따라 대한 위한 등등 기타 해당 각각'.split(' '));
const keep=[];
for(const x of rows){const w=x.w;
 if(A.has(w)){keep.push(x);continue;}
 if(w.length<2||STOP.has(w))continue;
 if(P.some(p=>w.endsWith(p)&&w.length>p.length&&all.has(w.slice(0,-p.length))))continue;
 keep.push(x);}
const words=[...new Set([...keep.map(x=>x.w),...ans])];
const hint=keep.filter(x=>x.h>=5&&x.r<150000).map(x=>x.w);
fs.writeFileSync('ft/vocab.txt',words.join('\n'));fs.writeFileSync('ft/hintable.txt',hint.join('\n'));
console.log('vocab',words.length,'hintable',hint.length);
