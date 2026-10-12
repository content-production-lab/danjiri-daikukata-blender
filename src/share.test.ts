import { describe, expect, it } from 'vitest';
import { formatTime, shareText, xIntentUrl, GAME_URL } from './share';

describe('X 投稿', () => {
  const r = { time: 112.34, score: 10385, rank: { letter: 'A' as const, name: '見事' } };

  it('タイムを分:秒で表す', () => {
    expect(formatTime(112.34)).toBe('1:52.3');
    expect(formatTime(65.04)).toBe('1:05.0');
  });

  it('投稿文にタイム・スコア・ランク・ハッシュタグが入る', () => {
    const t = shareText(r);
    expect(t).toContain('1:52.3');
    expect(t).toContain('10,385');
    expect(t).toContain('A「見事」');
    expect(t).toContain('#だんじり大工方');
  });

  it('X の投稿画面の URL に文と URL がエンコードされて入る', () => {
    const u = new URL(xIntentUrl(r));
    expect(u.origin + u.pathname).toBe('https://x.com/intent/post');
    expect(u.searchParams.get('text')).toBe(shareText(r));
    expect(u.searchParams.get('url')).toBe(GAME_URL);
  });
});
