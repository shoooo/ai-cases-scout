import Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./sources";

export interface Evaluation {
  is_use_case: boolean;
  is_product_launch: boolean;
  summary_ja: string;
  business_impact: string | null;
  industry: string;
  priority_score: number;
}

export interface EvaluatedArticle extends Article {
  evaluation: Evaluation;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `あなたは海外のAI動向を調査するリサーチアシスタントです。
記事を分析し、以下の2つの観点で判定してください。

【is_use_case】
実際の企業・組織がAIを業務や製品に活用している具体的な事例かどうか。
- true: 企業・組織によるAI導入・活用の実例（業務効率化、製品機能、顧客向けサービスなど）
- false: 研究論文、モデル発表のみ、技術解説、意見記事など

【is_product_launch】
新しいAIプロダクト・ツール・サービスのリリース情報かどうか。
- true: AIを中核とした新製品・新機能・新サービスの発表やローンチ
- false: 既存製品のニュース、技術解説、事例記事など

※ is_use_case と is_product_launch は両方 true になることもある（例：企業がAI新製品をリリースした事例）
※ どちらも false の場合はスキップ対象

必ず以下のJSON形式のみで回答してください（他のテキストは含めない）:
{
  "is_use_case": boolean,
  "is_product_launch": boolean,
  "summary_ja": "3〜5文の日本語要約。改行なしで1段落にまとめること。",
  "business_impact": "定量/定性的な成果（不明な場合はnull）",
  "industry": "業界分類（医療/金融/EC/製造/教育/メディア/物流/HR/デベロッパーツール/その他）"
}`;

// ソース別の優先度スコア（高いほど上位表示）
const SOURCE_PRIORITY: Record<string, number> = {
  "Ramp Engineering": 20,
  "Anthropic": 20,
  "a16z": 10,
};

async function evaluateOne(article: Article): Promise<Evaluation> {
  const prompt = `タイトル: ${article.title}
URL: ${article.url}
本文冒頭:
${article.content || "(本文なし)"}`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse evaluation JSON for: ${article.title}`);
  }
  const baseEval = JSON.parse(jsonMatch[0]) as Omit<Evaluation, "priority_score">;

  // ソース別の優先度スコアを追加
  const priorityScore = SOURCE_PRIORITY[article.source] ?? 0;

  return {
    ...baseEval,
    priority_score: priorityScore,
  };
}

export async function evaluateArticles(articles: Article[]): Promise<EvaluatedArticle[]> {
  const results: EvaluatedArticle[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (article) => {
        const evaluation = await evaluateOne(article);
        return { ...article, evaluation };
      })
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.warn("Evaluation failed:", result.reason);
      }
    }

    if (i + CONCURRENCY < articles.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}
