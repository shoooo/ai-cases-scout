# AI Cases Scout

海外のAI活用事例・プロダクトリリース情報を自動収集し、日本語要約付きでSlackに通知するサービス。

## 概要

Hacker News、Reddit、TechCrunch等からAI関連の記事を収集し、Claudeで「活用事例」か「プロダクトリリース」かを判定・要約。殷勤な宛先にはSlackへ通知する。

## 機能

- **情報収集**: RSSフィード/Web APIから12時間ごとに記事を取得
- **AI判定**: Claude Sonnet 4.6で「活用事例」「プロダクトリリース」の2軸で評価
- **重複排除**: URLベースで7日間の重複排除
- **Slack通知**: 朝昼(6-18時)/夜(18-6時)のセッション区分で送信

### 対応ソース

| ソース | 種別 |
|--------|------|
| Hacker News | コミュニティ |
| Reddit (r/MachineLearning, r/artificial) | コミュニティ |
| TechCrunch AI | メディア |
| VentureBeat AI | メディア |
| MIT Technology Review | メディア |
| The Verge AI | メディア |
| Wired AI | メディア |
| Product Hunt | プロダクト |
| a16z blog | VC/戦略 |
| Ramp Engineering | 技術ブログ |
| Anthropic Blog | 技術ブログ |

## アーキテクチャ

```
GitHub (source) → api/collect.ts → src/sources.ts
                                    ↓
                              src/evaluator.ts (Claude API)
                                    ↓
                              src/slack.ts (Slack Webhook)
```

## セットアップ

```bash
npm install
```

### 環境変数

`.env.local`

```
ANTHROPIC_API_KEY=sk-ant-xxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
```

## 開発

```bash
# ローカル実行
npm run test:collect

# TypeScriptチェック
npm run build
```

## 実行方法

```bash
# 手動実行
npm run test:collect

# または直接
ts-node --esm api/collect.ts
```

## 関連リソース

- [Claude API](https://docs.anthropic.com/)
- [Vercel Cron](https://vercel.com/docs/cron-jobs)
