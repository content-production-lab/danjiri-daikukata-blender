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

  it('失敗のときは失敗の種類・理由・進んだ角の数が入る', () => {
    const t = shareText({
      time: 45.2,
      score: 1234,
      rank: { letter: 'D', name: '出直し' },
      failure: { kind: 'fall', detail: '右へ振られて屋根から落ちた', corners: 2, totalCorners: 5 },
    });
    expect(t).toContain('転落…（右へ振られて屋根から落ちた）');
    expect(t).toContain('2/5 の角まで');
    expect(t).toContain('0:45.2');
    expect(t).toContain('D「出直し」');
    expect(t).not.toContain('宮入り');
    const w = shareText({ ...r, failure: { kind: 'wrecked', detail: '', corners: 0, totalCorners: 5 } });
    expect(w.split('\n')[0]).toBe('だんじり大工方で曳行中止…');
  });

  it('難易度を添える', () => {
    expect(shareText({ ...r, difficulty: 'やさしい' }).split('\n')[0]).toBe('だんじり大工方（やさしい）で宮入り！');
  });

  it('補助の違う操作方式を結果に明記する', () => {
    expect(shareText({ ...r, difficulty: 'ふつう', operation: 'かんたん操作' })).toContain('ふつう・かんたん操作');
  });

  it('X の投稿画面の URL に文と URL がエンコードされて入る', () => {
    const u = new URL(xIntentUrl(r));
    expect(u.origin + u.pathname).toBe('https://x.com/intent/post');
    expect(u.searchParams.get('text')).toBe(shareText(r));
    expect(u.searchParams.get('url')).toBe(GAME_URL);
  });
});
