import RSSParser from "rss-parser";

export interface Article {
  title: string;
  url: string;
  content: string;
  source: string;
  imageUrl?: string;
}

const AI_KEYWORDS = ["AI", "LLM", "GPT", "machine learning", "artificial intelligence", "deep learning"];

function containsAIKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// Extract image URL from RSS item (tries multiple common fields)
function extractRssImage(item: any): string | undefined {
  return (
    item["media:thumbnail"]?.$.url ||
    item["media:content"]?.$.url ||
    item.enclosure?.url ||
    undefined
  );
}

// Fetch plain text content from a webpage (used to enrich Product Hunt items)
async function fetchPageText(url: string, maxLength = 1500): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ai-cases-scout/1.0 (automated research tool)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Strip scripts, styles, and tags; collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxLength);
  } catch {
    return "";
  }
}

async function fetchHackerNews(): Promise<Article[]> {
  const LOOKBACK_HOURS = 12;
  const cutoff = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;

  const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  const ids: number[] = await topStoriesRes.json();

  const top200 = ids.slice(0, 200);
  const items = await Promise.allSettled(
    top200.map((id) =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json())
    )
  );

  const articles: Article[] = [];
  for (const result of items) {
    if (result.status !== "fulfilled") continue;
    const item = result.value;
    if (!item || !item.title || !item.url) continue;
    if (item.time && item.time < cutoff) continue;
    if (!containsAIKeyword(item.title)) continue;

    articles.push({
      title: item.title,
      url: item.url,
      content: item.text ? item.text.replace(/<[^>]*>/g, "").slice(0, 500) : "",
      source: "HackerNews",
    });
  }
  return articles;
}

async function fetchReddit(): Promise<Article[]> {
  const subreddits = [
    "https://www.reddit.com/r/MachineLearning/top.json?t=day&limit=25",
    "https://www.reddit.com/r/artificial/top.json?t=day&limit=25",
  ];

  const headers = { "User-Agent": "ai-cases-scout/1.0 (automated research tool)" };
  const articles: Article[] = [];

  for (const url of subreddits) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`Reddit fetch failed for ${url}: ${res.status}`);
      continue;
    }
    const data = await res.json();
    const posts = data?.data?.children ?? [];

    for (const post of posts) {
      const { title, url: postUrl, selftext, subreddit, thumbnail } = post.data;
      if (!title || !postUrl) continue;

      const validThumbnail =
        thumbnail && thumbnail.startsWith("http") ? thumbnail : undefined;

      articles.push({
        title,
        url: postUrl.startsWith("https://www.reddit.com")
          ? `https://reddit.com${post.data.permalink}`
          : postUrl,
        content: (selftext ?? "").slice(0, 500),
        source: `Reddit r/${subreddit}`,
        imageUrl: validThumbnail,
      });
    }
  }
  return articles;
}

async function fetchRSS(): Promise<Article[]> {
  const feeds = [
    // News
    { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch" },
    { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat" },
    { url: "https://www.technologyreview.com/feed/", source: "MIT Technology Review" },
    // Product系
    { url: "https://www.producthunt.com/feed", source: "Product Hunt" },
    // コラム・海外AI雰囲気
    { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge AI" },
    { url: "https://www.wired.com/feed/tag/ai/latest/rss", source: "Wired AI" },
    { url: "https://a16z.com/feed/", source: "a16z" },
    // 企業技術ブログ
    { url: "https://ramp.com/blog/engineering/rss", source: "Ramp Engineering" },
    { url: "https://www.anthropic.com/blog/rss.xml", source: "Anthropic" },
  ];

  const parser = new RSSParser({
    customFields: {
      item: [
        ["media:thumbnail", "media:thumbnail"],
        ["media:content", "media:content"],
      ],
    },
  });

  const articles: Article[] = [];

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const MAX_PER_FEED = 8;
      let feedCount = 0;
      for (const item of parsed.items ?? []) {
        if (feedCount >= MAX_PER_FEED) break;
        if (!item.title || !item.link) continue;

        let content = (item.contentSnippet ?? item.content ?? "").slice(0, 500);
        const imageUrl = extractRssImage(item as any);

        // Product Hunt RSS has minimal content — fetch the page to get a real description
        if (feed.source === "Product Hunt" && content.length < 200 && item.link) {
          const pageText = await fetchPageText(item.link, 1500);
          if (pageText.length > content.length) content = pageText;
        }

        articles.push({
          title: item.title,
          url: item.link,
          content,
          source: feed.source,
          imageUrl,
        });
        feedCount++;
      }
    } catch (err) {
      console.warn(`RSS fetch failed for ${feed.url}:`, err);
    }
  }
  return articles;
}

export async function fetchAllArticles(): Promise<Article[]> {
  const [hn, reddit, rss] = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchRSS(),
  ]);

  const all: Article[] = [];
  if (hn.status === "fulfilled") all.push(...hn.value);
  else console.warn("HackerNews fetch failed:", hn.reason);

  if (reddit.status === "fulfilled") all.push(...reddit.value);
  else console.warn("Reddit fetch failed:", reddit.reason);

  if (rss.status === "fulfilled") all.push(...rss.value);
  else console.warn("RSS fetch failed:", rss.reason);

  // Deduplicate by URL within a single run
  const seenUrls = new Set<string>();
  const deduped = all.filter((a) => {
    if (seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    return true;
  });

  const counts = {
    hn: hn.status === "fulfilled" ? hn.value.length : 0,
    reddit: reddit.status === "fulfilled" ? reddit.value.length : 0,
    rss: rss.status === "fulfilled" ? rss.value.length : 0,
  };
  console.log(`Fetched ${deduped.length} articles total after dedup (HN: ${counts.hn}, Reddit: ${counts.reddit}, RSS: ${counts.rss})`);
  return deduped;
}
