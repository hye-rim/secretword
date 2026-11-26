# 게임 사전 1.9만 단어 전체를 KURE-v1 + 문장 틀 4개 평균으로 임베딩
import sys, numpy as np, time
from sentence_transformers import SentenceTransformer
words = [l.split('\t')[0] for l in open(sys.argv[1], encoding='utf-8').read().split('\n') if l]
m = SentenceTransformer('nlpai-lab/KURE-v1', device='mps')
t0 = time.time()
tpl = ['{}', '{}라는 단어', '{}에 대해', '{}의 뜻']
V = np.mean([m.encode([t.format(w) for w in words], normalize_embeddings=True, batch_size=256) for t in tpl], axis=0).astype(np.float32)
np.save(sys.argv[2], V)
print('done', V.shape, f'{time.time()-t0:.0f}s', flush=True)
