// 練習と本編の切替。入力・描画・DOMには依存しない。
import { MAIN_COURSE, TUTORIAL_COURSE } from './course';
import { Game, type GameEvent, type PlayerInput } from './game';
import { type Difficulty } from './guide';

export type ControlMode = 'simple' | 'manual';
export const CONTROL_NAMES: Record<ControlMode, string> = { simple: 'かんたん操作', manual: '手動操作' };
export type Lesson = 'start' | 'stop' | 'resume' | 'right' | 'left' | 'ready' | 'failed' | 'main';

export class PlaySession {
  game: Game;
  lesson: Lesson;
  /** 最初の右折・左折と、各「戻せ」で入力を待つ。 */
  waitingSteer = 0;
  private passedCues = new Set<string>();

  constructor(readonly difficulty: Difficulty, readonly mode: ControlMode, tutorial = false) {
    this.lesson = tutorial ? 'start' : 'main';
    this.game = this.createGame(tutorial);
  }

  get training(): boolean {
    return this.lesson !== 'main';
  }

  private createGame(training: boolean): Game {
    const simple = this.mode === 'simple';
    const d = this.difficulty;
    return new Game({
      assist: training || simple ? 1 : d.leanAssist,
      steerAssist: training ? 0 : d.steerAssist,
      autoBrake: training || simple || d.autoBrake,
      cruiseKmh: training ? 22 : simple ? 26 : undefined,
      damageScale: training ? 0.5 : d.damageScale,
      startAt: training ? 4 : 0,
      course: training ? TUTORIAL_COURSE : MAIN_COURSE,
    });
  }

  retryTutorial(): void {
    if (!this.training) return;
    this.lesson = 'start';
    this.waitingSteer = 0;
    this.passedCues.clear();
    this.game = this.createGame(true);
  }

  /** 練習の得点・時間・傷み・乱数状態を引き継がず、同じ本編開始状態へ。 */
  startMain(): void {
    if (!this.training) return;
    this.lesson = 'main';
    this.waitingSteer = 0;
    this.game = this.createGame(false);
  }

  update(dt: number, input: PlayerInput): GameEvent[] {
    if (this.lesson === 'ready' || this.lesson === 'failed') return [];
    if (this.lesson === 'start' || this.lesson === 'resume') {
      if (!input.pull || input.brake) return [];
      this.lesson = this.lesson === 'start' ? 'stop' : 'right';
    }
    const g = this.game;
    if (this.lesson === 'stop') {
      if (input.brake && g.kmh < 0.5) {
        this.lesson = 'resume';
        return [];
      }
      // 操作を読む時間を確保し、停止練習を飛ばして角に入らない。
      if (g.s >= 45 && !input.brake) return [];
    }
    if (this.lesson === 'right' || this.lesson === 'left') {
      const gd = g.guide;
      const key = `${gd.corner?.index}:${gd.cue}`;
      const want = gd.cue === 'now' ? gd.corner?.dir ?? 0 : gd.cue === 'back' ? -(gd.corner?.dir ?? 0) : 0;
      if (want && !this.passedCues.has(key)) {
        this.waitingSteer = want;
        if (input.steer * want < 0.2) return [];
        this.passedCues.add(key);
      }
      this.waitingSteer = 0;
    }
    g.update(dt, input);
    const events = g.drainEvents();
    if (!this.training) return events;
    if (g.ended === 'goal') this.lesson = 'ready';
    else if (g.ended) this.lesson = 'failed';
    else if (g.results.length >= 1) this.lesson = 'left';
    // 練習での失敗・加減点を本編の結果画面や加点表示へ流さない。
    return [];
  }
}
