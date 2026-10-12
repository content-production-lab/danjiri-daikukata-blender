// X への投稿画面の URL を作る。API は使わず、X の投稿画面を開くだけ。

import type { Rank } from './sim/score';

export const GAME_URL = 'https://content-production-lab.github.io/danjiri-daikukata-blender/';
export const HASHTAG = 'だんじり大工方';

/** 秒 → 「1:52.3」 */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function shareText(o: { time: number; score: number; rank: Rank }): string {
  return [
    'だんじり大工方で宮入り！',
    `タイム ${formatTime(o.time)}／スコア ${o.score.toLocaleString('ja-JP')}`,
    `総合ランク ${o.rank.letter}「${o.rank.name}」`,
    `#${HASHTAG}`,
  ].join('\n');
}

export function xIntentUrl(o: { time: number; score: number; rank: Rank }, url = GAME_URL): string {
  // スペースを + ではなく %20 にするため encodeURIComponent を使う
  return `https://x.com/intent/post?text=${encodeURIComponent(shareText(o))}&url=${encodeURIComponent(url)}`;
}
