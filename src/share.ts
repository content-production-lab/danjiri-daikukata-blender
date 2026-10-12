// X への投稿画面の URL を作る。API は使わず、X の投稿画面を開くだけ。

import type { Rank } from './sim/score';

export const GAME_URL = 'https://content-production-lab.github.io/danjiri-daikukata-blender/';
export const HASHTAG = 'だんじり大工方';

/** 失敗で終わったときの情報（宮入りなら省く） */
export interface Failure {
  kind: 'fall' | 'overturn' | 'wrecked';
  /** 転落の理由など。無ければ空 */
  detail: string;
  /** 曲がり終えた角の数と、角の総数 */
  corners: number;
  totalCorners: number;
}

export interface ShareResult {
  time: number;
  score: number;
  rank: Rank;
  failure?: Failure;
  /** 難易度の名前（例: やさしい） */
  difficulty?: string;
}

const FAILURE_WORD: Record<Failure['kind'], string> = {
  fall: '転落',
  overturn: '横転',
  wrecked: '曳行中止',
};

/** 秒 → 「1:52.3」 */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function shareText(o: ShareResult): string {
  const score = o.score.toLocaleString('ja-JP');
  const rank = `総合ランク ${o.rank.letter}「${o.rank.name}」`;
  const game = `だんじり大工方${o.difficulty ? `（${o.difficulty}）` : ''}`;
  if (!o.failure) {
    return [`${game}で宮入り！`, `タイム ${formatTime(o.time)}／スコア ${score}`, rank, `#${HASHTAG}`].join('\n');
  }
  const f = o.failure;
  return [
    `${game}で${FAILURE_WORD[f.kind]}…${f.detail ? `（${f.detail}）` : ''}`,
    `${f.corners}/${f.totalCorners} の角まで／タイム ${formatTime(o.time)}／スコア ${score}`,
    rank,
    `#${HASHTAG}`,
  ].join('\n');
}

export function xIntentUrl(o: ShareResult, url = GAME_URL): string {
  // スペースを + ではなく %20 にするため encodeURIComponent を使う
  return `https://x.com/intent/post?text=${encodeURIComponent(shareText(o))}&url=${encodeURIComponent(url)}`;
}
