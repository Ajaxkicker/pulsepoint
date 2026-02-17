const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const path = require('path');
const webPush = require('web-push');

const app = express();
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Web Push (VAPID) Configuration
// ---------------------------------------------------------------------------
// Use env vars on deployed server; fall back to auto-generated keys for local dev.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

let vapidPublicKey = '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails('mailto:pulsepoint@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
  vapidPublicKey = VAPID_PUBLIC;
  console.log('  🔑 VAPID keys loaded from environment');
} else {
  // Auto-generate for local development (subscriptions won't persist across restarts)
  const generatedKeys = webPush.generateVAPIDKeys();
  webPush.setVapidDetails('mailto:pulsepoint@example.com', generatedKeys.publicKey, generatedKeys.privateKey);
  vapidPublicKey = generatedKeys.publicKey;
  console.log('  🔑 VAPID keys auto-generated (dev mode)');
  console.log('  📋 Public Key:', generatedKeys.publicKey);
  console.log('  📋 Private Key:', generatedKeys.privateKey);
  console.log('  ℹ️  Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars for production.\n');
}

// In-memory push subscription store
const pushSubscriptions = new Map();

// ---------------------------------------------------------------------------
// RSS Feed Configuration — Targeted, Section-Specific Feeds (Feb 2026)
// ---------------------------------------------------------------------------
const FEEDS = [
  // ── Global Finance & Markets ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', category: 'finance', region: 'global', source: 'CNBC' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', category: 'finance', region: 'global', source: 'CNBC Investing' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'finance', region: 'global', source: 'MarketWatch' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'finance', region: 'global', source: 'BBC Business' },
  { url: 'https://fortune.com/feed/', category: 'business', region: 'global', source: 'Fortune' },

  // ── Global Macro & Policy ──
  { url: 'https://feeds.npr.org/1006/rss.xml', category: 'macro', region: 'global', source: 'NPR Business' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', category: 'macro', region: 'global', source: 'CNBC Economy' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', category: 'macro', region: 'global', source: 'Google News' },

  // ── Global Business & Strategy ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', category: 'business', region: 'global', source: 'CNBC Business' },
  { url: 'https://www.entrepreneur.com/latest.rss', category: 'strategy', region: 'global', source: 'Entrepreneur' },
  { url: 'http://feeds.harvardbusiness.org/harvardbusiness?format=xml', category: 'strategy', region: 'global', source: 'HBR' },

  // ── Global Startups & VC ──
  { url: 'https://techcrunch.com/feed/', category: 'startups', region: 'global', source: 'TechCrunch' },
  { url: 'https://techcrunch.com/category/startups/feed/', category: 'startups', region: 'global', source: 'TechCrunch Startups' },

  // ── India Business & Economy ──
  { url: 'https://economictimes.indiatimes.com/rssfeeds/1977021.cms', category: 'finance', region: 'india', source: 'ET Markets' },
  { url: 'https://economictimes.indiatimes.com/rssfeeds/13358378.cms', category: 'business', region: 'india', source: 'ET Industry' },
  { url: 'https://economictimes.indiatimes.com/rssfeeds/13352306.cms', category: 'business', region: 'india', source: 'ET Companies' },
  { url: 'https://www.livemint.com/rss/companies', category: 'business', region: 'india', source: 'Livemint Companies' },
  { url: 'https://www.livemint.com/rss/markets', category: 'finance', region: 'india', source: 'Livemint Markets' },
  { url: 'https://www.livemint.com/rss/industry', category: 'business', region: 'india', source: 'Livemint Industry' },

  // ── India Markets ──
  { url: 'https://www.moneycontrol.com/rss/business.xml', category: 'business', region: 'india', source: 'Moneycontrol' },
  { url: 'https://www.business-standard.com/rss/markets-106.rss', category: 'finance', region: 'india', source: 'Business Standard Mkt' },
  { url: 'https://www.business-standard.com/rss/companies-101.rss', category: 'business', region: 'india', source: 'Business Standard Co' },

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
// MBA Relevance Filter — keyword whitelist
// ---------------------------------------------------------------------------
const MBA_KEYWORDS = [
  // Finance & Markets
  'market', 'stock', 'equity', 'bond', 'ipo', 'fund', 'investor', 'portfolio',
  'dividend', 'earnings', 'forex', 'treasury', 'sensex', 'nifty', 'nasdaq',
  'dow jones', 'wall street', 'share price', 'bull', 'bear', 'rally', 'crash',
  'mutual fund', 'etf', 'derivative', 'commodity', 'futures',
  // Economics & Policy
  'economy', 'gdp', 'inflation', 'deflation', 'recession', 'fiscal', 'monetary',
  'interest rate', 'central bank', 'rbi', 'federal reserve', 'tariff', 'trade',
  'export', 'import', 'currency', 'rupee', 'dollar', 'budget', 'tax', 'subsidy',
  'policy', 'regulation', 'sanction', 'debt', 'surplus', 'deficit',
  // Business & Strategy
  'business', 'corporate', 'enterprise', 'ceo', 'cfo', 'coo', 'board',
  'merger', 'acquisition', 'revenue', 'profit', 'loss', 'growth', 'disruption',
  'innovation', 'supply chain', 'logistics', 'retail', 'ecommerce',
  'manufacturing', 'industry', 'sector', 'quarterly', 'annual report',
  'market share', 'brand', 'franchise', 'privatization', 'disinvestment',
  // Startups & VC
  'startup', 'venture', 'funding', 'valuation', 'unicorn', 'series a', 'series b',
  'series c', 'accelerator', 'incubator', 'angel investor', 'seed round',
  'fintech', 'saas', 'b2b', 'b2c', 'pivot', 'scale-up', 'bootstrap',
  // Industry-specific
  'banking', 'insurance', 'pharma', 'healthcare', 'energy', 'oil', 'crude',
  'gold', 'real estate', 'infrastructure', 'telecom', 'aviation', 'automobile',
  'ev ', 'electric vehicle', 'semiconductor', 'ai ', 'artificial intelligence',
  'cloud', 'cybersecurity', 'blockchain', 'crypto',
  // Management & Leadership
  'leadership', 'management', 'strategy', 'governance', 'esg', 'sustainability',
  'workforce', 'layoff', 'hiring', 'compensation', 'restructuring',
  'digital transformation', 'ipo', 'listing', 'delisting',
];

function isRelevant(article) {
  const text = (article.title + ' ' + article.summary).toLowerCase();
  return MBA_KEYWORDS.some((kw) => text.includes(kw));
}

// ---------------------------------------------------------------------------
// Negative Blocklist — reject clearly irrelevant content
// ---------------------------------------------------------------------------
const BLOCKLIST = [
  // Sports
  'cricket', ' ipl ', 'world cup', 'champions league', 'premier league',
  'fifa', 'tennis', 'golf tournament', 'formula 1', 'olympics', 'wrestling',
  'kabaddi', 'badminton', 'hockey score', 'football score', 'match result',
  'batting', 'bowling', 'wicket',
  // Entertainment
  'bollywood', 'hollywood', 'movie review', 'box office', 'celebrity gossip',
  'reality show', 'tv show', 'red carpet', 'award show', 'grammy', 'oscar',
  'bigg boss', 'trailer release', 'song launch',
  // Lifestyle
  'horoscope', 'astrology', 'zodiac', 'recipe', 'cooking tips',
  'fashion week', 'beauty tips', 'travel destination', 'vacation',
  'wedding', 'matrimony',
  // Crime / Tabloid
  'murder accused', 'kidnap', 'missing person', 'road rage', 'domestic violence',
];

function isNotBlocked(article) {
  const text = (article.title + ' ' + article.summary).toLowerCase();
  return !BLOCKLIST.some((term) => text.includes(term));
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

  // Relevance filtering — remove irrelevant & blocked content
  const beforeFilter = articles.length;
  articles = articles.filter(isNotBlocked);
  articles = articles.filter(isRelevant);
  console.log(`  🔍 Relevance filter: ${beforeFilter} → ${articles.length} articles (${beforeFilter - articles.length} removed)`);

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
      // --- Breaking news detection: find new articles not in old cache ---
      if (cachedArticles.length > 0 && pushSubscriptions.size > 0) {
        const oldTitles = new Set(cachedArticles.map(a => a.title.toLowerCase()));
        const newArticles = freshArticles.filter(a => !oldTitles.has(a.title.toLowerCase()));
        if (newArticles.length > 0) {
          const top = newArticles[0]; // Most recent new article
          sendPushToAll({
            title: '📰 ' + top.source,
            body: top.title,
            url: top.url || '/',
          });
          console.log(`  🔔 Push notification sent: "${top.title.substring(0, 60)}..."`);
        }
      }

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
// Send push notification to all subscribers
// ---------------------------------------------------------------------------
async function sendPushToAll(payload) {
  const payloadStr = JSON.stringify(payload);
  const deadEndpoints = [];

  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webPush.sendNotification(sub, payloadStr);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription expired or unsubscribed
        deadEndpoints.push(endpoint);
      } else {
        console.warn(`  ⚠ Push failed for ${endpoint.substring(0, 50)}...:`, err.message);
      }
    }
  }

  // Clean up dead subscriptions
  deadEndpoints.forEach(ep => pushSubscriptions.delete(ep));
}

// ---------------------------------------------------------------------------
// Push Notification API Routes
// ---------------------------------------------------------------------------
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  pushSubscriptions.set(sub.endpoint, sub);
  console.log(`  🔔 Push subscription added (${pushSubscriptions.size} total)`);
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    pushSubscriptions.delete(endpoint);
    console.log(`  🔕 Push subscription removed (${pushSubscriptions.size} total)`);
  }
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// News API Route
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
