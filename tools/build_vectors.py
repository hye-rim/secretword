# 사전 = 지금 1.9만 + 연상 목록에만 있던 낱말. 벡터 = KURE(연상 틀) 40% + KR-SBERT(단어 틀) 40% + fastText 20% → PCA 192 → int8
import sys, csv, re, numpy as np
from scipy.stats import spearmanr
SP, G = sys.argv[1], sys.argv[2]
cur = [l.split('\t') for l in open(G + '/public/data/words.txt', encoding='utf-8').read().split('\n') if l]
n0 = len(cur)
miss = [w for w in open(SP + '/emb/assoc_missing_all.txt', encoding='utf-8').read().split('\n') if w]
big = [l.split('\t')[0] for l in open(SP + '/emb/big_words.txt', encoding='utf-8').read().split('\n') if l]
assert big[:n0] == [w for w, _ in cur], 'same order'
K = np.vstack([np.load(SP + '/emb/big_kure_assoc.npy')[:n0], np.load(SP + '/emb/missall_kure_assoc.npy')]).astype(np.float64)
S = np.vstack([np.load(SP + '/emb/big_krsbert_avg4.npy')[:n0], np.load(SP + '/emb/missall_krsbert_avg4.npy')]).astype(np.float64)
fw = open(SP + '/ft/v.words.txt', encoding='utf-8').read().split('\n') + open(SP + '/ft/add.words.txt', encoding='utf-8').read().split('\n') + open(SP + '/ft/assocmiss.words.txt', encoding='utf-8').read().split('\n') + open(SP + '/ft/assocmiss2.words.txt', encoding='utf-8').read().split('\n')
ff = np.vstack([np.fromfile(SP + f, dtype=np.float32).reshape(-1, 300) for f in ['/ft/v.f32', '/ft/add.f32', '/ft/assocmiss.f32', '/ft/assocmiss2.f32']])
fmap = {w: i for i, w in enumerate(fw)}
words = [w for w, _ in cur] + miss
F = np.array([ff[fmap[w]] if w in fmap else np.zeros(300, np.float32) for w in words], dtype=np.float64)
has = np.linalg.norm(F, axis=1) > 0
def cn(X, mask=None):
    m = X[mask].mean(0) if mask is not None else X.mean(0); X = X - m
    if mask is not None: X[~mask] = 0
    n = np.linalg.norm(X, axis=1, keepdims=True); n[n == 0] = 1; return X / n
WF = 0.2
V = np.hstack([np.sqrt((1 - WF) / 2) * cn(K), np.sqrt((1 - WF) / 2) * cn(S), np.sqrt(WF) * cn(F, has)]); V -= V.mean(0)
_, _, Vt = np.linalg.svd(V[np.random.RandomState(1).choice(len(V), 12000, replace=False)], full_matrices=False)
Z = V @ Vt[:192].T; Z /= np.linalg.norm(Z, axis=1, keepdims=True)
Q = np.round(Z / np.abs(Z).max(1, keepdims=True) * 127).astype(np.int8)
# 표시: 정답 2 그대로, 연상 목록 낱말·자주 쓰이는 낱말 1, 나머지 0
assoc = set()
for f in ['a1', 'a2', 'a3', 'a4']:
    for l in open(G + f'/tools/assoc/{f}.txt', encoding='utf-8').read().split('\n'):
        if l and not l.startswith('#') and ':' in l: assoc.update(x.strip() for x in l.split(':', 1)[1].split(',') if x.strip())
flags = [f for _, f in cur] + ['0'] * len(miss)
flags = ['2' if f == '2' else '1' if (f == '1' or w in assoc) else '0' for w, f in zip(words, flags)]
Q.tofile(G + '/public/data/vecs.bin')
open(G + '/public/data/words.txt', 'w', encoding='utf-8').write(''.join(f'{w}\t{f}\n' for w, f in zip(words, flags)))
R = Q.astype(np.float64); R /= np.linalg.norm(R, axis=1, keepdims=True); idx = {w: i for i, w in enumerate(words)}
ws = [r for r in csv.reader(open(SP + '/bench/ws353_ko.csv', encoding='utf-8-sig'))][1:]
cov = [(a.strip(), b.strip(), float(s)) for a, b, s in ws if a.strip() in idx and b.strip() in idx]
print('words', len(words), 'flag1', flags.count('1'), 'bytes', Q.nbytes, 'WS353', round(spearmanr([s for *_, s in cov], [R[idx[a]] @ R[idx[b]] for a, b, _ in cov]).correlation, 3), len(cov))
for q in ['나무', '나침반', '머리', '우비', '바나나', '연필', '공항']:
    s = R @ R[idx[q]]; s[idx[q]] = -9; print(q, ' '.join(words[j] for j in np.argsort(-s)[:10]))
