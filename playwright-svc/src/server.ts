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

const UNSUPPORTED_HOST_SUFFIXES = [
  'instagram.com',
  'facebook.com',
  'whatsapp.com',
  'api.whatsapp.com',
  'wa.me',
  'linktr.ee',
  'tiktok.com',
  'youtube.com',
  'maps.google.com',
  'dguests.com',
];

type WebsiteResponse = {
  title: string;
  description: string;
  text_content: string;
  technologies: string[];
  links: string[];
  source: 'playwright' | 'http_fallback' | 'skipped';
  skipped_reason?: string;
};

// Browser pool
const POOL_SIZE = parseInt(process.env.BROWSER_POOL_SIZE || '5', 10);
const browserPool: Browser[] = [];
let poolInitialized = false;
let poolIdx = 0;

async function initPool(): Promise<void> {
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

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function getPage(ua: string): Promise<{ page: Page; context: BrowserContext }> {
  const browser = browserPool[poolIdx % POOL_SIZE];
  poolIdx++;

  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, context };
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

function hostIsUnsupported(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return UNSUPPORTED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function extractMetaDescription(html: string): string {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (m?.[1]) return normalizeSpace(decodeHtmlEntities(m[1]));
  const m2 = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  return m2?.[1] ? normalizeSpace(decodeHtmlEntities(m2[1])) : '';
}

function stripHtmlToText(html: string): string {
  return normalizeSpace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function extractLinks(html: string, baseURL: URL): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null = re.exec(html);
  while (match) {
    try {
      const abs = new URL(match[1], baseURL).toString();
      if ((abs.startsWith('http://') || abs.startsWith('https://')) && !seen.has(abs)) {
        seen.add(abs);
        links.push(abs);
      }
    } catch {
      // ignore malformed links
    }
    if (links.length >= 20) break;
    match = re.exec(html);
  }
  return links;
}

function detectTechnologiesFromContent(content: string): string[] {
  const techPatterns: Record<string, RegExp> = {
    React: /react/i,
    'Vue.js': /vue/i,
    Angular: /angular/i,
    'Next.js': /next/i,
    WordPress: /wp-content|wp-includes/i,
    Shopify: /shopify/i,
    jQuery: /jquery/i,
    Bootstrap: /bootstrap/i,
    Tailwind: /tailwind/i,
    'Google Analytics': /google-analytics|gtag/i,
    HubSpot: /hubspot/i,
    Intercom: /intercom/i,
    Hotjar: /hotjar/i,
  };

  const out: string[] = [];
  for (const [tech, pattern] of Object.entries(techPatterns)) {
    if (pattern.test(content)) out.push(tech);
  }
  return out;
}

async function scrapeWebsiteWithPlaywright(targetURL: URL): Promise<WebsiteResponse> {
  const { page, context } = await getPage(randomUA());
  try {
    await page.goto(targetURL.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const title = normalizeSpace(await page.title());
    const description = await page
      .$eval('meta[name="description"]', (el) => (el.getAttribute('content') || '').trim())
      .catch(() => '');

    const textContent = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      const elements = body.querySelectorAll('p, h1, h2, h3, li');
      return Array.from(elements)
        .map((el) => el.textContent?.trim() || '')
        .filter(Boolean)
        .slice(0, 120)
        .join(' ');
    });

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith('http'))
        .slice(0, 20)
    );

    const technologies = await page.evaluate(() => {
      const html = document.documentElement?.outerHTML || '';
      const patterns: Record<string, RegExp> = {
        React: /react/i,
        'Vue.js': /vue/i,
        Angular: /angular/i,
        'Next.js': /next/i,
        WordPress: /wp-content|wp-includes/i,
        Shopify: /shopify/i,
        jQuery: /jquery/i,
        Bootstrap: /bootstrap/i,
        Tailwind: /tailwind/i,
        'Google Analytics': /google-analytics|gtag/i,
        HubSpot: /hubspot/i,
        Intercom: /intercom/i,
        Hotjar: /hotjar/i,
      };
      const out: string[] = [];
      for (const [tech, pattern] of Object.entries(patterns)) {
        if (pattern.test(html)) out.push(tech);
      }
      return out;
    });

    return {
      title,
      description: normalizeSpace(description),
      text_content: normalizeSpace(textContent).slice(0, 4000),
      technologies,
      links,
      source: 'playwright',
    };
  } finally {
    await context.close();
  }
}

async function scrapeWebsiteWithHTTPFallback(targetURL: URL): Promise<WebsiteResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(targetURL.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': randomUA(),
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`http status ${res.status}`);
    }

    const html = await res.text();
    const finalURL = new URL(res.url || targetURL.toString());

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1] ? normalizeSpace(decodeHtmlEntities(titleMatch[1])) : '';
    const description = extractMetaDescription(html);
    const textContent = stripHtmlToText(html).slice(0, 4000);
    const links = extractLinks(html, finalURL);
    const technologies = detectTechnologiesFromContent(html);

    return {
      title,
      description,
      text_content: textContent,
      technologies,
      links,
      source: 'http_fallback',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Health
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', pool_size: browserPool.length });
});

// Scrape website
app.post('/scrape/website', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: 'url required' });

  let targetURL: URL;
  try {
    targetURL = await ensurePublicURL(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid url';
    return res.status(400).json({ error: msg });
  }

  if (hostIsUnsupported(targetURL.hostname)) {
    const skipped: WebsiteResponse = {
      title: '',
      description: '',
      text_content: '',
      technologies: [],
      links: [],
      source: 'skipped',
      skipped_reason: 'unsupported_host',
    };
    return res.json(skipped);
  }

  try {
    const result = await scrapeWebsiteWithPlaywright(targetURL);
    return res.json(result);
  } catch (playwrightErr: unknown) {
    const playwrightMsg = playwrightErr instanceof Error ? playwrightErr.message : 'unknown error';
    console.warn(`Playwright scrape failed for ${targetURL.toString()}: ${playwrightMsg}`);

    try {
      const fallbackResult = await scrapeWebsiteWithHTTPFallback(targetURL);
      return res.json(fallbackResult);
    } catch (fallbackErr: unknown) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : 'unknown error';
      console.error(`HTTP fallback failed for ${targetURL.toString()}: ${fallbackMsg}`);
      return res.status(500).json({ error: 'website scrape failed' });
    }
  }
});

// Scrape Reclame Aqui
app.post('/scrape/reclame-aqui', async (req: Request, res: Response) => {
  const { company_name } = req.body as { company_name?: string };
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

    const score = await page
      .evaluate(() => {
        const el = document.querySelector('[data-testid="company-score"]');
        return el ? parseFloat((el.textContent || '0').replace(',', '.')) : 0;
      })
      .catch(() => 0);

    const complaintsCount = await page
      .evaluate(() => {
        const el = document.querySelector('[data-testid="complaints-count"]');
        return el ? parseInt((el.textContent || '0').replace(/\D/g, ''), 10) : 0;
      })
      .catch(() => 0);

    return res.json({
      found: true,
      score,
      solution_rate: score / 10,
      complaints_count: complaintsCount,
      summary: `Score: ${score}/10, ${complaintsCount} reclamacoes`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.warn(`Reclame Aqui scrape error (${company_name}): ${msg}`);
    return res.json({ found: false, score: 0, solution_rate: 0, complaints_count: 0, summary: '' });
  } finally {
    await context.close();
  }
});

// Google search
app.post('/scrape/google-search', async (req: Request, res: Response) => {
  const { query, limit = 5 } = req.body as { query?: string; limit?: number };
  if (!query) return res.status(400).json({ error: 'query required' });

  const { page, context } = await getPage(randomUA());
  try {
    const lim = Math.max(1, Math.min(limit ?? 5, 10));
    const searchURL = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${lim}`;
    await page.goto(searchURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const results = await page.evaluate((maxCount: number) => {
      const items = document.querySelectorAll('div.g');
      return Array.from(items)
        .slice(0, maxCount)
        .map((item) => ({
          title: item.querySelector('h3')?.textContent || '',
          url: (item.querySelector('a') as HTMLAnchorElement | null)?.href || '',
          snippet: item.querySelector('.VwiC3b')?.textContent || '',
        }))
        .filter((r) => r.title && r.url);
    }, lim);

    return res.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.warn(`Google search error (${query}): ${msg}`);
    return res.status(500).json({ error: 'google search failed' });
  } finally {
    await context.close();
  }
});

initPool()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Playwright service listening on port ${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to initialize browser pool:', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('Shutting down playwright-svc...');
  for (const browser of browserPool) {
    await browser.close();
  }
  process.exit(0);
});
