import { readFileSync, writeFileSync } from "fs";
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

const SEEN_URLS_PATH = resolve(process.cwd(), "seen-urls.json");
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

function loadSeenUrls(): Set<string> {
  try {
    const data = JSON.parse(readFileSync(SEEN_URLS_PATH, "utf-8")) as { url: string; seenAt: string }[];
    const cutoff = Date.now() - SEEN_TTL_MS;
    return new Set(data.filter((e) => new Date(e.seenAt).getTime() > cutoff).map((e) => e.url));
  } catch {
    return new Set();
  }
}

function saveSeenUrls(newUrls: string[]): void {
  const cutoff = Date.now() - SEEN_TTL_MS;
  let existing: { url: string; seenAt: string }[] = [];
  try {
    existing = JSON.parse(readFileSync(SEEN_URLS_PATH, "utf-8"));
    existing = existing.filter((e) => new Date(e.seenAt).getTime() > cutoff);
  } catch {
    // file doesn't exist yet
  }
  const existingSet = new Set(existing.map((e) => e.url));
  const now = new Date().toISOString();
  for (const url of newUrls) {
    if (!existingSet.has(url)) existing.push({ url, seenAt: now });
  }
  writeFileSync(SEEN_URLS_PATH, JSON.stringify(existing, null, 2));
}

async function run(): Promise<{ checked: number; useCases: number }> {
  console.log("=== AI Cases Scout: Starting collection ===");

  // 1. Fetch articles from all sources
  console.log("\n[1] Fetching articles...");
  const allArticles = await fetchAllArticles();
  console.log(`Total articles fetched: ${allArticles.length}`);

  // 2. Filter already-seen URLs
  const seenUrls = loadSeenUrls();
  const articles = allArticles.filter((a) => !seenUrls.has(a.url));
  console.log(`New articles (not seen before): ${articles.length}`);
  saveSeenUrls(allArticles.map((a) => a.url));

  if (articles.length === 0) {
    console.log("No new articles, exiting.");
    return { checked: 0, useCases: 0 };
  }

  // 3. Evaluate with Claude
  console.log("\n[2] Evaluating with Claude...");
  const evaluated = await evaluateArticles(articles);
  const useCases = evaluated
    .filter((a) => a.evaluation.is_use_case || a.evaluation.is_product_launch)
    .sort((a, b) => b.evaluation.priority_score - a.evaluation.priority_score);
  console.log(`Use cases identified: ${useCases.length} / ${evaluated.length}`);

  // 4. Notify Slack
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
