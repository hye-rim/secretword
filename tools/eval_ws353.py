# 같은 쌍(게임 사전에 둘 다 있는 쌍)으로 공정 비교 + 문장 틀 + 모델 합치기(meta-embedding: 정규화 벡터 이어 붙이기 = 코사인 평균)
import csv, sys, numpy as np
from scipy.stats import spearmanr
from sentence_transformers import SentenceTransformer
SP = sys.argv[1]
rows = [r for r in csv.reader(open(SP + '/bench/ws353_ko.csv', encoding='utf-8-sig'))][1:]
pairs = [(a.strip(), b.strip(), float(s)) for a, b, s in rows]
fw = open(SP + '/ft/v.words.txt', encoding='utf-8').read().split('\n')
fv = np.fromfile(SP + '/ft/v.f32', dtype=np.float32).reshape(len(fw), 300)
fidx = {w: i for i, w in enumerate(fw)}
cov = [p for p in pairs if p[0] in fidx and p[1] in fidx]
words = sorted({w for a, b, _ in cov for w in (a, b)})
human = [s for *_, s in cov]
def score(V):  # V: dict word -> normalized vec
    return spearmanr(human, [float(V[a] @ V[b]) for a, b, _ in cov]).correlation
ft = {w: fv[fidx[w]] / np.linalg.norm(fv[fidx[w]]) for w in words}
print(f'pairs {len(cov)}  fastText-300 (no PCA) {score(ft):.3f}', flush=True)
res = {}
for name, pre in [('nlpai-lab/KURE-v1', ''), ('snunlp/KR-SBERT-V40K-klueNLI-augSTS', ''), ('intfloat/multilingual-e5-large', 'query: '), ('BAAI/bge-m3', '')]:
    m = SentenceTransformer(name, device='mps')
    for tname, tpl in [('word', ['{}']), ('avg4', ['{}', '{}라는 단어', '{}에 대해', '{}의 뜻'])]:
        V = np.mean([m.encode([pre + t.format(w) for w in words], normalize_embeddings=True) for t in tpl], axis=0)
        V /= np.linalg.norm(V, axis=1, keepdims=True)
        D = {w: V[i] for i, w in enumerate(words)}
        res[(name, tname)] = D
        meta = {w: np.concatenate([D[w], ft[w]]) / np.sqrt(2) for w in words}
        print(f'{name:40s} {tname:5s} alone {score(D):.3f}  +fastText {score(meta):.3f}', flush=True)
