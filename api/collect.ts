import { readFileSync } from "fs";
import { resolve } from "path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAllArticles } from "../src/sources";
import { evaluateArticles } from "../src/evaluator";
import { sendSlackNotification } from "../src/slack";

function loadEnvLocal(): void {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found, skip
  }
}

async function run(): Promise<{ checked: number; useCases: number }> {
  console.log("=== AI Cases Scout: Starting collection ===");

  // 1. Fetch articles from all sources
  console.log("\n[1] Fetching articles...");
  const articles = await fetchAllArticles();
  console.log(`Total articles fetched: ${articles.length}`);

  if (articles.length === 0) {
    console.log("No articles fetched, exiting.");
    return { checked: 0, useCases: 0 };
  }

  // 2. Evaluate with Claude
  console.log("\n[2] Evaluating with Claude...");
  const evaluated = await evaluateArticles(articles);
  const useCases = evaluated.filter((a) => a.evaluation.is_use_case);
  console.log(`Use cases identified: ${useCases.length} / ${evaluated.length}`);

  // 3. Notify Slack
  console.log("\n[3] Sending Slack notification...");
  await sendSlackNotification(articles.length, useCases);

  console.log("\n=== Done ===");
  return { checked: articles.length, useCases: useCases.length };
}

// Vercel Serverless Function handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.NODE_ENV === "production") {
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const result = await run();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("Collection failed:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

// Allow running directly with ts-node
const isDirectRun =
  process.argv[1]?.endsWith("collect.ts") || process.argv[1]?.endsWith("collect.js");

if (isDirectRun) {
  loadEnvLocal();
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
