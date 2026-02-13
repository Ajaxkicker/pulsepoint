const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// RSS Feed Configuration — Verified Working Feeds (Feb 2026)
// ---------------------------------------------------------------------------
const FEEDS = [
  // ── Global Finance & Markets ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', category: 'finance', region: 'global', source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'finance', region: 'global', source: 'MarketWatch' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'finance', region: 'global', source: 'BBC Business' },
  { url: 'https://fortune.com/feed/', category: 'business', region: 'global', source: 'Fortune' },

  // ── Global Macro & Policy ──
  { url: 'https://feeds.npr.org/1006/rss.xml', category: 'macro', region: 'global', source: 'NPR Business' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', category: 'macro', region: 'global', source: 'CNBC Economy' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', category: 'macro', region: 'global', source: 'Google News' },

  // ── Global Business & Strategy ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', category: 'business', region: 'global', source: 'CNBC Business' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', category: 'business', region: 'global', source: 'BBC Tech' },
  { url: 'https://www.entrepreneur.com/latest.rss', category: 'strategy', region: 'global', source: 'Entrepreneur' },

  // ── Global Startups & VC ──
  { url: 'https://techcrunch.com/feed/', category: 'startups', region: 'global', source: 'TechCrunch' },
  { url: 'https://techcrunch.com/category/startups/feed/', category: 'startups', region: 'global', source: 'TechCrunch Startups' },

  // ── India Business & Economy ──
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', category: 'business', region: 'india', source: 'Economic Times' },
  { url: 'https://economictimes.indiatimes.com/rssfeeds/13358378.cms', category: 'business', region: 'india', source: 'ET Markets' },
  { url: 'https://www.livemint.com/rss/news', category: 'finance', region: 'india', source: 'Livemint' },
  { url: 'https://www.livemint.com/rss/markets', category: 'finance', region: 'india', source: 'Livemint Markets' },

  // ── India Markets ──
  { url: 'https://www.moneycontrol.com/rss/latestnews.xml', category: 'finance', region: 'india', source: 'Moneycontrol' },
  { url: 'https://www.business-standard.com/rss/markets-106.rss', category: 'finance', region: 'india', source: 'Business Standard' },

  // ── India Policy & Economy ──
  { url: 'https://www.business-standard.com/rss/economy-policy-102.rss', category: 'macro', region: 'india', source: 'Business Standard' },
  { url: 'https://www.moneycontrol.com/rss/economy.xml', category: 'macro', region: 'india', source: 'Moneycontrol' },

  // ── India Startups ──
  { url: 'https://inc42.com/feed/', category: 'startups', region: 'india', source: 'Inc42' },
  { url: 'https://yourstory.com/feed', category: 'startups', region: 'india', source: 'YourStory' },
];

// ---------------------------------------------------------------------------
// In-Memory Cache
// ---------------------------------------------------------------------------
let cachedArticles = [];
let lastFetchTime = 0;
let fetchInProgress = false;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Title Similarity (bigram-based Dice coefficient)
// ---------------------------------------------------------------------------
function bigrams(str) {
  const s = str.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const tokens = [];
  for (let i = 0; i < s.length - 1; i++) {
    tokens.push(s.substring(i, i + 2));
  }
  return tokens;
}

function similarity(a, b) {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0;
  const setB = new Set(bigramsB);
  let matches = 0;
  for (const bg of bigramsA) {
    if (setB.has(bg)) matches++;
  }
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

function deduplicateArticles(articles) {
  const result = [];
  for (const article of articles) {
    let isDuplicate = false;
    for (const existing of result) {
      if (similarity(article.title, existing.title) > 0.8) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) result.push(article);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Strip HTML tags from summaries
// ---------------------------------------------------------------------------
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Fetch All Feeds
// ---------------------------------------------------------------------------
async function fetchAllFeeds() {
  console.log(`[${new Date().toISOString()}] Fetching RSS feeds...`);
  let successCount = 0;
  let failCount = 0;

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        const items = (parsed.items || []).map((item) => ({
          title: stripHtml(item.title || '').substring(0, 300),
          summary: stripHtml(item.contentSnippet || item.content || item.description || '').substring(0, 500),
          url: item.link || '',
          source: feed.source,
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          category: feed.category,
          region: feed.region,
        }));
        successCount++;
        console.log(`  ✓ ${feed.source}: ${items.length} articles`);
        return items;
      } catch (err) {
        failCount++;
        console.warn(`  ⚠ Feed failed: ${feed.source} (${feed.url}) — ${err.message}`);
        return [];
      }
    })
  );

  let articles = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      articles = articles.concat(result.value);
    }
  }

  // Filter out articles without a title
  articles = articles.filter((a) => a.title && a.title.length > 5);

  // Deduplicate
  articles = deduplicateArticles(articles);

  // Sort by publishedAt descending
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  console.log(`  ── ${successCount}/${FEEDS.length} feeds OK, ${failCount} failed → ${articles.length} unique articles`);
  return articles;
}

async function refreshCache() {
  // Prevent concurrent fetches
  if (fetchInProgress) {
    console.log('  ⏳ Fetch already in progress, skipping...');
    return;
  }
  fetchInProgress = true;

  try {
    const freshArticles = await fetchAllFeeds();

    // CRITICAL: Only update cache if we got articles.
    // Never overwrite a good cache with an empty one due to transient network failures.
    if (freshArticles.length > 0) {
      cachedArticles = freshArticles;
      lastFetchTime = Date.now();
      console.log(`  ✅ Cache updated: ${cachedArticles.length} articles\n`);
    } else if (cachedArticles.length > 0) {
      // Keep the old cache, just update the timestamp so we retry later
      lastFetchTime = Date.now();
      console.log(`  ⚠ All feeds failed — keeping previous cache of ${cachedArticles.length} articles\n`);
    } else {
      console.log(`  ⚠ No articles available yet — will retry on next request\n`);
      // Don't update lastFetchTime so it retries immediately on next API call
    }
  } catch (err) {
    console.error('Cache refresh error:', err.message);
  } finally {
    fetchInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// API Route
// ---------------------------------------------------------------------------
app.get('/api/news', async (req, res) => {
  // Refresh cache if stale
  if (Date.now() - lastFetchTime > CACHE_DURATION) {
    await refreshCache();
  }

  let articles = [...cachedArticles];

  // Filter by category
  if (req.query.category) {
    articles = articles.filter(
      (a) => a.category.toLowerCase() === req.query.category.toLowerCase()
    );
  }

  // Filter by region
  if (req.query.region) {
    articles = articles.filter(
      (a) => a.region.toLowerCase() === req.query.region.toLowerCase()
    );
  }

  res.json(articles);
});

// ---------------------------------------------------------------------------
// Market Data Proxy (avoids CORS issues with Yahoo Finance)
// ---------------------------------------------------------------------------
app.get('/api/market', async (req, res) => {
  const symbols = ['^BSESN', '^NSEI', '^GSPC', '^IXIC', 'USDINR=X', 'CL=F', 'GC=F', '^TNX'];
  const results = {};

  await Promise.allSettled(
    symbols.map(async (symbol) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        if (price && prevClose) {
          results[symbol] = {
            price,
            change: (((price - prevClose) / prevClose) * 100).toFixed(2),
          };
        }
      } catch (e) {
        // skip this symbol
      }
    })
  );

  res.json(results);
});

// ---------------------------------------------------------------------------
// Catch-all: serve the frontend
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`\n  🟢 PulsePoint running on http://localhost:${PORT}\n`);
  // Pre-warm cache on startup
  await refreshCache();
  // Auto-refresh every 30 minutes
  setInterval(refreshCache, CACHE_DURATION);
});
