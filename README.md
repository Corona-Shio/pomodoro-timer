# Analog Pomodoro Timer

Vite + React + TypeScript で作成した、アナログ風ポモドーロタイマーです。

## 機能

- 分単位の設定（1〜180分）
- クイック調整ボタン（`-10`, `-5`, `+5`, `+10`）
- 残り時間に応じて赤背景が下から減るアナログ盤
- 作業内容つきのセッション記録（`localStorage`）
- 本日のタイムボクシングを24時間タイムラインで表示

## 開発

```bash
npm install
npm run dev
```

## テスト

```bash
npm run test
```

## ビルド

```bash
npm run build
```

## GitHub Pages 公開

このリポジトリには `.github/workflows/deploy-pages.yml` を同梱しており、`main` ブランチへの push で自動デプロイされます。

1. GitHub リポジトリの `Settings > Pages` を開く
2. `Build and deployment` の `Source` を `GitHub Actions` に設定
3. `main` に push すると Actions が `dist` を公開

公開 URL は通常:

- `https://<your-account>.github.io/pomodoro-timer/`

`vite.config.ts` の `base` は `/pomodoro-timer/` を設定済みです。リポジトリ名を変える場合は `base` も合わせて変更してください。
