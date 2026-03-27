import express, { Request, Response } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3002', 10);
const PROXY_URL = process.env.PROXY_URL || '';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
];

// Browser pool
const POOL_SIZE = parseInt(process.env.BROWSER_POOL_SIZE || '5', 10);
const browserPool: Browser[] = [];
let poolInitialized = false;

async function initPool() {
  if (poolInitialized) return;
  poolInitialized = true;

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  if (PROXY_URL) {
    launchOptions.proxy = { server: PROXY_URL };
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const browser = await chromium.launch(launchOptions);
    browserPool.push(browser);
  }
  console.log(`Browser pool initialized (${POOL_SIZE} browsers)`);
}

let poolIdx = 0;
async function getPage(ua: string): Promise<{ page: Page; context: BrowserContext }> {
  const browser = browserPool[poolIdx % POOL_SIZE];
  poolIdx++;
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, context };
}

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
}

async function ensurePublicURL(rawURL: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    throw new Error('invalid url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('private hostname is not allowed');
  }

  if (net.isIP(host)) {
    if ((net.isIPv4(host) && isPrivateIPv4(host)) || (net.isIPv6(host) && isPrivateIPv6(host))) {
      throw new Error('private IP is not allowed');
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (records.length === 0) {
    throw new Error('hostname not resolvable');
  }

  for (const record of records) {
    if ((record.family === 4 && isPrivateIPv4(record.address)) || (record.family === 6 && isPrivateIPv6(record.address))) {
      throw new Error('hostname resolves to private address');
    }
  }

  return parsed;
}

// ─── Health ────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', pool_size: browserPool.length });
});

// ─── Scrape Website ────────────────────────────────────────────────────────

app.post('/scrape/website', async (req: Request, res: Response) => {
  const { url } = req.body as { url: string };
  if (!url) return res.status(400).json({ error: 'url required' });

  let targetURL: URL;
  try {
    targetURL = await ensurePublicURL(url);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'invalid url' });
  }

  const { page, context } = await getPage(randomUA());
  try {
    await page.goto(targetURL.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const title = await page.title();
    const description = await page.$eval(
      'meta[name="description"]',
      (el) => el.getAttribute('content') || '',
    ).catch(() => '');

    const textContent = await page.evaluate(() => {
      const body = document.body;
      const elements = body.querySelectorAll('p, h1, h2, h3, li');
      return Array.from(elements)
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 50)
        .join(' ');
    });

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith('http'))
        .slice(0, 20),
    );

    // Detect technologies via meta tags and script srcs
    const technologies: string[] = await page.evaluate(() => {
      const techs: string[] = [];
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(
        (s) => (s as HTMLScriptElement).src,
      );
      const techPatterns: Record<string, RegExp> = {
        'React': /react/i,
        'Vue.js': /vue/i,
        'Angular': /angular/i,
        'Next.js': /next/i,
        'WordPress': /wp-content|wp-includes/i,
        'Shopify': /shopify/i,
        'jQuery': /jquery/i,
        'Bootstrap': /bootstrap/i,
        'Tailwind': /tailwind/i,
        'Google Analytics': /google-analytics|gtag/i,
        'HubSpot': /hubspot/i,
        'Intercom': /intercom/i,
        'Hotjar': /hotjar/i,
      };
      for (const [tech, pattern] of Object.entries(techPatterns)) {
        if (scripts.some((s) => pattern.test(s)) || pattern.test(document.head.innerHTML)) {
          techs.push(tech);
        }
      }
      return techs;
    });

    return res.json({ title, description, text_content: textContent.slice(0, 2000), technologies, links });
  } catch (err: any) {
    console.error('Website scrape error:', err.message);
    return res.status(500).json({ error: 'website scrape failed' });
  } finally {
    await context.close();
  }
});

// ─── Scrape Reclame Aqui ──────────────────────────────────────────────────

app.post('/scrape/reclame-aqui', async (req: Request, res: Response) => {
  const { company_name } = req.body as { company_name: string };
  if (!company_name) return res.status(400).json({ error: 'company_name required' });

  const { page, context } = await getPage(randomUA());
  try {
    const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await page.goto(`https://www.reclameaqui.com.br/empresa/${slug}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const notFound = await page.$('[data-testid="not-found"]').catch(() => null);
    if (notFound) {
      return res.json({ found: false, score: 0, solution_rate: 0, complaints_count: 0, summary: '' });
    }

    const score = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="company-score"]');
      return el ? parseFloat(el.textContent?.replace(',', '.') || '0') : 0;
    }).catch(() => 0);

    const complaintsCount = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="complaints-count"]');
      return el ? parseInt(el.textContent?.replace(/\D/g, '') || '0', 10) : 0;
    }).catch(() => 0);

    const summary = `Score: ${score}/10, ${complaintsCount} reclamações`;

    return res.json({
      found: true,
      score,
      solution_rate: score / 10,
      complaints_count: complaintsCount,
      summary,
    });
  } catch (err: any) {
    console.error('Reclame Aqui scrape error:', err.message);
    return res.json({ found: false, score: 0, solution_rate: 0, complaints_count: 0, summary: '' });
  } finally {
    await context.close();
  }
});

// ─── Google Search ────────────────────────────────────────────────────────

app.post('/scrape/google-search', async (req: Request, res: Response) => {
  const { query, limit = 5 } = req.body as { query: string; limit: number };
  if (!query) return res.status(400).json({ error: 'query required' });

  const { page, context } = await getPage(randomUA());
  try {
    const searchURL = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;
    await page.goto(searchURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const results = await page.evaluate((lim: number) => {
      const items = document.querySelectorAll('div.g');
      return Array.from(items)
        .slice(0, lim)
        .map((item) => ({
          title: item.querySelector('h3')?.textContent || '',
          url: (item.querySelector('a') as HTMLAnchorElement)?.href || '',
          snippet: item.querySelector('.VwiC3b')?.textContent || '',
        }))
        .filter((r) => r.title && r.url);
    }, limit);

    return res.json({ results });
  } catch (err: any) {
    console.error('Google search error:', err.message);
    return res.status(500).json({ error: 'google search failed' });
  } finally {
    await context.close();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────

initPool()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Playwright service listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize browser pool:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down playwright-svc...');
  for (const browser of browserPool) {
    await browser.close();
  }
  process.exit(0);
});
