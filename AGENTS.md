# AGENTS.md

- 地車の大工方ゲーム（Blender版）。Vite + TypeScript + three.js。GitHub Pages（`content-production-lab/danjiri-daikukata-blender`）へ main への push で自動デプロイ。仕様の正本は `docs/SPEC.md`。
- 既存版 `content-production-lab/danjiri-daikukata` とは別プロジェクト。挙動計算はそこからコピーしたもので、両者を自動で同期しない。
- 挙動計算・採点は `src/sim/` に閉じ、描画・DOM に依存させない。変えたら `src/sim/*.test.ts` の完走・採点ケースを確認する。
- モデルは `blender/build_all.py` から生成し、生成物 `public/models/*.glb`・`public/og.png` もコミットする（CI では Blender を使わない）。材質名で three.js 側の材質（`src/render/models.ts`）と対応させる。
- 完了前に `npm run check`（lint・typecheck・test・build）を通す。
- 外部の画像・3D・音素材や AI 生成画像を追加する場合はライセンスを確認し、README に出典・AI生成の旨を書く。
