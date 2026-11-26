# 방송 시즌3 히든 워드 실제 기록으로 모델 비교: 사람(방송 AI) 점수와 순서가 얼마나 맞는지 + 95%+ 힌트가 사전 안에서 몇 위인지
import sys, numpy as np
from scipy.stats import spearmanr
from sentence_transformers import SentenceTransformer
SP, G = sys.argv[1], sys.argv[2]
D = [('나무','질책',2.5),('나무','삼투압',48.5),('나무','딱딱함',54),('나무','도토리',78.5),('나무','버섯',82),('나무','소나무',97),('나무','뿌리',96.5),
 ('행복','불행',96.5),('자동차','바퀴',96),('질문','꾸중',32),('질문','오답',63),('질문','탐구심',84.5),('복수','원한',97),('도장','태권도',97),('목욕탕','샤워',97),('목욕탕','목욕',99.5),('길','버스',90),
 ('대기','열',97),('대기','층',91),('대기','질서',97),('손님','주인',97),('손님','소유주',65.5),('손님','고객',99.8),('사고','자동차',91.5),('사고','차량',97),('사고','테슬라',52),('사고','지능',92),('사고','뇌',97),
 ('회사','일',97),('서점','수필',80),('서점','책',97),('이별','지구',8.5),('이별','슬픔',97),('머리','미용실',97),('대화','이야기',97),('우비','소설',5),('우비','우산',96.5),('나침반','북쪽',97),('수도','도시',96.5),('수도','건설',91.5),('수도','서울',97)]
vocab = [l.split('\t')[0] for l in open(G + '/public/data/words.txt', encoding='utf-8').read().split('\n') if l]
extra = sorted({w for a, b, _ in D for w in (a, b)} - set(vocab))
allw = vocab + extra
hi = [(a, b) for a, b, v in D if v >= 95]
def report(name, V):
    V = V / np.linalg.norm(V, axis=1, keepdims=True); idx = {w: i for i, w in enumerate(allw)}
    rho = spearmanr([v for *_, v in D], [V[idx[a]] @ V[idx[b]] for a, b, _ in D]).correlation
    ranks = []
    for a, b in hi:
        s = V[:len(vocab)] @ V[idx[a]]
        if idx[a] < len(vocab): s[idx[a]] = -9
        ranks.append(int((s > V[idx[b]] @ V[idx[a]]).sum()) + 1)
    ranks = np.array(ranks)
    print(f'{name:48s} spearman {rho:.3f} | 95+ hints rank median {int(np.median(ranks))}  top50 {np.mean(ranks<=50):.0%}  top200 {np.mean(ranks<=200):.0%}', flush=True)
TPL = {'word': ['{}'], 'avg4': ['{}', '{}라는 단어', '{}에 대해', '{}의 뜻'], 'assoc': ['{}', '{}와 관련된 것', '{}을 떠올리면 생각나는 것', '{}의 여러 가지 뜻']}
for name, pre in [('nlpai-lab/KURE-v1', ''), ('BAAI/bge-m3', ''), ('intfloat/multilingual-e5-large', 'query: '), ('snunlp/KR-SBERT-V40K-klueNLI-augSTS', '')]:
    m = SentenceTransformer(name, device='mps')
    for tn in ['word', 'avg4', 'assoc']:
        V = np.mean([m.encode([pre + t.format(w) for w in allw], normalize_embeddings=True, batch_size=256) for t in TPL[tn]], axis=0)
        V = V - V.mean(0)
        report(f'{name} {tn}', V)
        np.save(f'{SP}/emb/show_{name.split("/")[1]}_{tn}.npy', V.astype(np.float32))
open(SP + '/emb/show_allwords.txt', 'w', encoding='utf-8').write('\n'.join(allw))
