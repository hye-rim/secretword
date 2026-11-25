// PCA(평균 빼고) -> k차원 -> 정규화 -> int8. 순위가 얼마나 보존되는지 잰다
const fs=require('fs');const pre=process.argv[2],K=+process.argv[3];
const W=fs.readFileSync(pre+'.words.txt','utf8').split('\n');const B=fs.readFileSync(pre+'.f32');const V=new Float32Array(B.buffer,B.byteOffset,B.length/4);const D=300,N=W.length;
const mean=new Float64Array(D);for(let i=0;i<N;i++)for(let k=0;k<D;k++)mean[k]+=V[i*D+k]/N;
const C=Array.from({length:D},()=>new Float64Array(D));const x=new Float64Array(D);
for(let i=0;i<N;i++){for(let k=0;k<D;k++)x[k]=V[i*D+k]-mean[k];for(let a=0;a<D;a++){const xa=x[a];const Ca=C[a];for(let b=a;b<D;b++)Ca[b]+=xa*x[b];}}
for(let a=0;a<D;a++)for(let b=0;b<a;b++)C[a][b]=C[b][a];
// 거듭제곱법 + 수축으로 위쪽 K개 고유벡터
const E=[];for(let e=0;e<K;e++){let v=new Float64Array(D).map(()=>Math.random()-.5);for(let it=0;it<200;it++){const w=new Float64Array(D);for(let a=0;a<D;a++){let s=0;for(let b=0;b<D;b++)s+=C[a][b]*v[b];w[a]=s;}for(const u of E){let d=0;for(let a=0;a<D;a++)d+=w[a]*u[a];for(let a=0;a<D;a++)w[a]-=d*u[a];}let n=Math.hypot(...w);v=w.map(t=>t/n);}E.push(v);}
const Q=new Int8Array(N*K);const P=new Float32Array(N*K);
for(let i=0;i<N;i++){let n=0;for(let e=0;e<K;e++){let s=0;for(let k=0;k<D;k++)s+=(V[i*D+k]-mean[k])*E[e][k];P[i*K+e]=s;n+=s*s;}n=Math.sqrt(n);let m=0;for(let e=0;e<K;e++){P[i*K+e]/=n;m=Math.max(m,Math.abs(P[i*K+e]));}for(let e=0;e<K;e++)Q[i*K+e]=Math.round(P[i*K+e]/m*127);}
fs.writeFileSync(pre+'.q'+K+'.i8',Buffer.from(Q.buffer));
// 평가
const sim0=(a,b)=>{let s=0;for(let k=0;k<D;k++)s+=V[a*D+k]*V[b*D+k];return s;};
const qn=new Float32Array(N);for(let i=0;i<N;i++){let s=0;for(let e=0;e<K;e++)s+=Q[i*K+e]**2;qn[i]=Math.sqrt(s);}
const sim1=(a,b)=>{let s=0;for(let e=0;e<K;e++)s+=Q[a*K+e]*Q[b*K+e];return s/qn[a]/qn[b];};
const idx=new Map(W.map((w,i)=>[w,i]));let ov10=0,ov100=0,cnt=0;
for(const q of '사과 바다 기차 의사 축구 음악 겨울 고양이 연필 해적 시험 크리스마스 피아노 병원 우산 전쟁'.split(' ')){const i=idx.get(q);const r0=W.map((_,j)=>[j,sim0(i,j)]).sort((a,b)=>b[1]-a[1]).map(t=>t[0]);const r1=W.map((_,j)=>[j,sim1(i,j)]).sort((a,b)=>b[1]-a[1]).map(t=>t[0]);
const s10=new Set(r0.slice(1,11)),s100=new Set(r0.slice(1,101));ov10+=r1.slice(1,11).filter(j=>s10.has(j)).length/10;ov100+=r1.slice(1,101).filter(j=>s100.has(j)).length/100;cnt++;
if(q==='사과'||q==='해적')console.log(q,r1.slice(1,11).map(j=>W[j]).join(' '));}
console.log('K',K,'top10 overlap',(ov10/cnt).toFixed(2),'top100',(ov100/cnt).toFixed(2),'bytes',Q.length);
