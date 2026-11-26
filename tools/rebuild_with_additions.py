# 기존 사전 + 추가 낱말을 합쳐 다시 만든다: KURE(문장 틀 평균) 35% + fastText 65% → 평균 빼고 PCA 192 → int8
import sys, numpy as np, csv
from scipy.stats import spearmanr
SP, G = sys.argv[1], sys.argv[2]
old = [l.split('\t') for l in open(G + '/public/data/words.txt', encoding='utf-8').read().split('\n') if l]
add = [w for w in open(SP + '/ft/add.words.txt', encoding='utf-8').read().split('\n') if w]
words = [w for w, _ in old] + add
flags = [int(f) for _, f in old] + [1] * len(add)
F = np.vstack([np.fromfile(SP + '/ft/v.f32', dtype=np.float32).reshape(len(old), 300), np.fromfile(SP + '/ft/add.f32', dtype=np.float32).reshape(len(add), 300)]).astype(np.float64)
K = np.vstack([np.load(SP + '/emb/kure_avg4.npy'), np.load(SP + '/emb/kure_add.npy')]).astype(np.float64)
def cn(X): X = X - X.mean(0); return X / np.linalg.norm(X, axis=1, keepdims=True)
W = 0.35
V = np.hstack([np.sqrt(W) * cn(K), np.sqrt(1 - W) * cn(F)]); V -= V.mean(0)
_, _, Vt = np.linalg.svd(V[np.random.RandomState(1).choice(len(V), 10000, replace=False)], full_matrices=False)
Z = V @ Vt[:192].T; Z /= np.linalg.norm(Z, axis=1, keepdims=True)
Q = np.round(Z / np.abs(Z).max(1, keepdims=True) * 127).astype(np.int8)
Q.tofile(G + '/public/data/vecs.bin')
open(G + '/public/data/words.txt', 'w', encoding='utf-8').write(''.join(f'{w}\t{f}\n' for w, f in zip(words, flags)))
R = Q.astype(np.float64); R /= np.linalg.norm(R, axis=1, keepdims=True); idx = {w: i for i, w in enumerate(words)}
rows = [r for r in csv.reader(open(SP + '/bench/ws353_ko.csv', encoding='utf-8-sig'))][1:]
cov = [(a.strip(), b.strip(), float(s)) for a, b, s in rows if a.strip() in idx and b.strip() in idx]
print('words', len(words), 'added', len(add), 'ws353 pairs', len(cov), 'spearman', round(spearmanr([s for *_, s in cov], [R[idx[a]] @ R[idx[b]] for a, b, _ in cov]).correlation, 3))
for q in ['나무', '대기', '물', '열', '꽃', '바다']:
    s = R @ R[idx[q]]; print(q, ' '.join(words[j] for j in np.argsort(-s)[1:11]))
