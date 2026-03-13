import type { EvaluatedArticle } from "./evaluator";

function articleCard(article: EvaluatedArticle, index: number): object[] {
  const { evaluation, title, url, source, imageUrl } = article;
  const industry = evaluation.industry;
  const impact = evaluation.business_impact;

  // Title block with optional thumbnail
  const titleSection: any = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${index + 1}. <${url}|${title}>*\n:label: ${industry}　:newspaper: ${source}`,
    },
  };
  if (imageUrl) {
    titleSection.accessory = {
      type: "image",
      image_url: imageUrl,
      alt_text: title,
    };
  }

  // Context block: summary + impact
  const contextElements: object[] = [
    { type: "mrkdwn", text: evaluation.summary_ja },
  ];
  if (impact) {
    contextElements.push({ type: "mrkdwn", text: `*インパクト:* ${impact}` });
  }

  return [
    titleSection,
    { type: "context", elements: contextElements },
    { type: "divider" },
  ];
}

function buildSlackMessage(
  checked: number,
  useCases: EvaluatedArticle[],
  sessionLabel: string
): object {
  const date = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const headerText = `AI活用事例 | ${sessionLabel}の収集完了 (${date})`;
  const subText = `チェック: ${checked}件　→　事例: ${useCases.length}件`;

  if (useCases.length === 0) {
    return {
      text: `${headerText} | ${subText}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${headerText}*\n${subText}\n\n該当する活用事例はありませんでした。` },
        },
      ],
    };
  }

  const top = useCases.slice(0, 10);
  const cards = top.flatMap((article, i) => articleCard(article, i));

  return {
    text: `${headerText} | ${subText}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: headerText, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: subText },
      },
      { type: "divider" },
      ...cards,
    ],
  };
}

export async function sendSlackNotification(
  checked: number,
  useCases: EvaluatedArticle[]
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL not set, skipping notification");
    return;
  }

  const hour = new Date().getUTCHours();
  const sessionLabel = hour >= 18 || hour < 6 ? "夜" : "朝";

  const payload = buildSlackMessage(checked, useCases, sessionLabel);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
  console.log("Slack notification sent");
}
