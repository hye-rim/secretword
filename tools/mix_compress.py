# 최종 단어 벡터: 평균 뺀 KURE(문장 틀 4개 평균)와 평균 뺀 fastText 를 w:1-w 로 이어 붙이고 → PCA k → int8
import csv, sys, numpy as np
from scipy.stats import spearmanr
SP, WORDS, OUT, W, KD = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), int(sys.argv[5])
words = [l.split('\t')[0] for l in open(WORDS, encoding='utf-8').read().split('\n') if l]
idx = {w: i for i, w in enumerate(words)}
F = np.fromfile(SP + '/ft/v.f32', dtype=np.float32).reshape(len(words), 300).astype(np.float64)
K = np.load(SP + '/emb/kure_avg4.npy').astype(np.float64)
def cn(X): X = X - X.mean(0); return X / np.linalg.norm(X, axis=1, keepdims=True)
V = np.hstack([np.sqrt(W) * cn(K), np.sqrt(1 - W) * cn(F)])
V = V - V.mean(0)
_, _, Vt = np.linalg.svd(V[np.random.RandomState(1).choice(len(V), 10000, replace=False)], full_matrices=False)
Z = V @ Vt[:KD].T
Z /= np.linalg.norm(Z, axis=1, keepdims=True)
Q = np.round(Z / np.abs(Z).max(1, keepdims=True) * 127).astype(np.int8)
Q.tofile(OUT)
R = Q.astype(np.float64); R /= np.linalg.norm(R, axis=1, keepdims=True)
rows = [r for r in csv.reader(open(SP + '/bench/ws353_ko.csv', encoding='utf-8-sig'))][1:]
cov = [(a.strip(), b.strip(), float(s)) for a, b, s in rows if a.strip() in idx and b.strip() in idx]
print('wrote', Q.shape, 'ws353', round(spearmanr([s for *_, s in cov], [R[idx[a]] @ R[idx[b]] for a, b, _ in cov]).correlation, 3))
for q in ['바나나', '연필', '공항', '도둑', '고양이', '겨울', '의사', '바다', '피아노', '선거']:
    s = R @ R[idx[q]]; print(q, ' '.join(f'{words[j]}:{s[j]:.2f}' for j in np.argsort(-s)[1:9]))
