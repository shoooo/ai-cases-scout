import Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./sources";

export interface Evaluation {
  is_use_case: boolean;
  summary_ja: string;
  business_impact: string | null;
  industry: string;
}

export interface EvaluatedArticle extends Article {
  evaluation: Evaluation;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `あなたは海外のAI活用事例を調査するリサーチアシスタントです。
記事を分析し、実際の企業によるAI活用事例かどうかを判定してください。

判定基準:
- is_use_case: true → 実際の企業・組織がAIを業務/製品に活用している事例
- is_use_case: false → 研究論文、モデル発表、技術解説、意見記事など

必ず以下のJSON形式のみで回答してください（他のテキストは含めない）:
{
  "is_use_case": boolean,
  "summary_ja": "3〜5文の日本語要約",
  "business_impact": "定量/定性的な成果（不明な場合はnull）",
  "industry": "業界分類（医療/金融/EC/製造/教育/メディア/物流/HR/その他）"
}`;

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
  return JSON.parse(jsonMatch[0]) as Evaluation;
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
