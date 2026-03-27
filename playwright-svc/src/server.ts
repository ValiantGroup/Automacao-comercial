import express, { NextFunction, Request, Response } from "express";
import dns from "node:dns/promises";
import net from "node:net";
import { chromium, Browser, BrowserContext, Page } from "playwright";

const app = express();
app.use(express.json());

function isJSONBodyParseError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const parseErr = err as {
    type?: string;
    status?: number;
    message?: string;
  };
  return (
    parseErr.type === "entity.parse.failed" ||
    (parseErr.status === 400 &&
      typeof parseErr.message === "string" &&
      parseErr.message.toLowerCase().includes("json"))
  );
}

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (isJSONBodyParseError(err)) {
    return res.status(400).json({ error: "invalid json body" });
  }
  return next(err);
});

const PORT = parseInt(process.env.PORT || "3002", 10);
const PROXY_URL = process.env.PROXY_URL || "";
const PROXY_BYPASS_MS = parseInt(
  process.env.PROXY_BYPASS_MS || `${10 * 60 * 1000}`,
  10,
);

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

const UNSUPPORTED_HOST_SUFFIXES = [
  "instagram.com",
  "facebook.com",
  "whatsapp.com",
  "api.whatsapp.com",
  "wa.me",
  "linktr.ee",
  "tiktok.com",
  "youtube.com",
  "maps.google.com",
  "dguests.com",
];

type WebsiteResponse = {
  title: string;
  description: string;
  text_content: string;
  technologies: string[];
  links: string[];
  source: "playwright" | "http_fallback" | "skipped";
  skipped_reason?: string;
};

function skippedWebsiteResponse(reason: string): WebsiteResponse {
  return {
    title: "",
    description: "",
    text_content: "",
    technologies: [],
    links: [],
    source: "skipped",
    skipped_reason: reason,
  };
}

// Browser pool
const POOL_SIZE = parseInt(process.env.BROWSER_POOL_SIZE || "5", 10);
const browserPool: Browser[] = [];
let poolInitialized = false;
let poolIdx = 0;
let directBrowser: Browser | null = null;
let proxyBypassUntil = 0;

async function initPool(): Promise<void> {
  if (poolInitialized) return;
  poolInitialized = true;

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
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

async function getDirectBrowser(): Promise<Browser> {
  if (directBrowser) return directBrowser;
  directBrowser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  console.warn("Initialized direct browser fallback (without proxy)");
  return directBrowser;
}

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function getPage(
  ua: string,
): Promise<{ page: Page; context: BrowserContext }> {
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

async function getDirectPage(
  ua: string,
): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await getDirectBrowser();
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { page, context };
}

function isProxyFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("err_proxy_connection_failed") ||
    msg.includes("err_tunnel_connection_failed") ||
    msg.includes("proxy")
  );
}

function isExecutionContextDestroyed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("execution context was destroyed") ||
    msg.includes("most likely because of a navigation") ||
    msg.includes("cannot find context with specified id")
  );
}

function isExpectedSiteUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("err_connection_refused") ||
    msg.includes("err_address_unreachable") ||
    msg.includes("err_internet_disconnected") ||
    msg.includes("err_name_not_resolved") ||
    msg.includes("err_too_many_redirects") ||
    msg.includes("err_connection_reset") ||
    msg.includes("err_connection_timed_out") ||
    msg.includes("err_ssl_protocol_error") ||
    msg.includes("err_ssl_version_or_cipher_mismatch") ||
    msg.includes("err_cert_") ||
    msg.includes("err_timed_out") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("eai_again") ||
    msg.includes("enotfound") ||
    msg.includes("tls handshake") ||
    msg.includes("ssl routines") ||
    msg.includes("socket hang up") ||
    msg.includes("hostname not resolvable") ||
    msg.includes("fetch failed") ||
    msg.includes("http status 404") ||
    msg.includes("http status 410") ||
    msg.includes("http status 429") ||
    msg.includes("http status 500") ||
    msg.includes("http status 502") ||
    msg.includes("http status 503") ||
    msg.includes("http status 521") ||
    msg.includes("http status 522") ||
    msg.includes("http status 525")
  );
}

function isProxyEnabledNow(): boolean {
  if (!PROXY_URL) return false;
  return Date.now() >= proxyBypassUntil;
}

function activateProxyBypass(reason: unknown): void {
  if (!PROXY_URL) return;
  const previous = proxyBypassUntil;
  proxyBypassUntil = Date.now() + Math.max(10_000, PROXY_BYPASS_MS);
  if (previous <= Date.now()) {
    const msg =
      reason instanceof Error ? reason.message : String(reason ?? "proxy error");
    console.warn(
      `Proxy failure detected (${msg}); switching to direct mode for ${Math.round(
        PROXY_BYPASS_MS / 1000,
      )}s`,
    );
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
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
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

async function ensurePublicURL(rawURL: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    throw new Error("invalid url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http/https are allowed");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("private hostname is not allowed");
  }

  if (net.isIP(host)) {
    if (
      (net.isIPv4(host) && isPrivateIPv4(host)) ||
      (net.isIPv6(host) && isPrivateIPv6(host))
    ) {
      throw new Error("private IP is not allowed");
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (records.length === 0) {
    throw new Error("hostname not resolvable");
  }
  for (const record of records) {
    if (
      (record.family === 4 && isPrivateIPv4(record.address)) ||
      (record.family === 6 && isPrivateIPv6(record.address))
    ) {
      throw new Error("hostname resolves to private address");
    }
  }
  return parsed;
}

function hostIsUnsupported(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return UNSUPPORTED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeSpace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function extractMetaDescription(html: string): string {
  const m = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  );
  if (m?.[1]) return normalizeSpace(decodeHtmlEntities(m[1]));
  const m2 = html.match(
    /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
  );
  return m2?.[1] ? normalizeSpace(decodeHtmlEntities(m2[1])) : "";
}

function stripHtmlToText(html: string): string {
  return normalizeSpace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
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
      if (
        (abs.startsWith("http://") || abs.startsWith("https://")) &&
        !seen.has(abs)
      ) {
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
    "Vue.js": /vue/i,
    Angular: /angular/i,
    "Next.js": /next/i,
    WordPress: /wp-content|wp-includes/i,
    Shopify: /shopify/i,
    jQuery: /jquery/i,
    Bootstrap: /bootstrap/i,
    Tailwind: /tailwind/i,
    "Google Analytics": /google-analytics|gtag/i,
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

async function scrapeWebsiteWithPlaywright(
  targetURL: URL,
  useDirect = false,
): Promise<WebsiteResponse> {
  const { page, context } = useDirect
    ? await getDirectPage(randomUA())
    : await getPage(randomUA());
  try {
    await page.goto(targetURL.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    let pageData:
      | {
          title: string;
          description: string;
          text: string;
          links: string[];
          html: string;
        }
      | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        if (attempt > 0) {
          await page.waitForTimeout(250);
        }

        pageData = await page.evaluate(() => {
          const title = document.title || "";
          const description =
            (
              document.querySelector('meta[name="description"]') as
                | HTMLMetaElement
                | null
            )?.content || "";

          const body = document.body;
          let text = "";
          if (body) {
            const elements = body.querySelectorAll("p, h1, h2, h3, li");
            text = Array.from(elements)
              .map((el) => el.textContent?.trim() || "")
              .filter(Boolean)
              .slice(0, 120)
              .join(" ");
          }

          const links = Array.from(document.querySelectorAll("a[href]"))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.startsWith("http"))
            .slice(0, 20);

          const html = document.documentElement?.outerHTML || "";
          return { title, description, text, links, html };
        });
        break;
      } catch (err: unknown) {
        if (attempt < 2 && isExecutionContextDestroyed(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!pageData) {
      throw new Error("unable to extract website data");
    }

    const technologies = detectTechnologiesFromContent(pageData.html);

    return {
      title: normalizeSpace(pageData.title),
      description: normalizeSpace(pageData.description),
      text_content: normalizeSpace(pageData.text).slice(0, 4000),
      technologies,
      links: pageData.links,
      source: "playwright",
    };
  } finally {
    await context.close();
  }
}

async function scrapeWebsiteWithHTTPFallback(
  targetURL: URL,
): Promise<WebsiteResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(targetURL.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": randomUA(),
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`http status ${res.status}`);
    }

    const html = await res.text();
    const finalURL = new URL(res.url || targetURL.toString());

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]
      ? normalizeSpace(decodeHtmlEntities(titleMatch[1]))
      : "";
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
      source: "http_fallback",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Health
app.get("/health", (_req: Request, res: Response) => {
  const now = Date.now();
  res.json({
    status: "ok",
    pool_size: browserPool.length,
    proxy_configured: !!PROXY_URL,
    proxy_enabled_now: isProxyEnabledNow(),
    proxy_bypass_seconds_remaining:
      proxyBypassUntil > now ? Math.ceil((proxyBypassUntil - now) / 1000) : 0,
  });
});

// Scrape website
app.post("/scrape/website", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: "url required" });

  let targetURL: URL;
  try {
    targetURL = await ensurePublicURL(url);
  } catch (err: unknown) {
    if (isExpectedSiteUnavailableError(err)) {
      return res.json(skippedWebsiteResponse("site_unreachable_or_invalid"));
    }
    const msg = err instanceof Error ? err.message : "invalid url";
    return res.status(400).json({ error: msg });
  }

  if (hostIsUnsupported(targetURL.hostname)) {
    return res.json(skippedWebsiteResponse("unsupported_host"));
  }

  const useProxy = isProxyEnabledNow();
  try {
    const result = await scrapeWebsiteWithPlaywright(targetURL, !useProxy);
    return res.json(result);
  } catch (playwrightErr: unknown) {
    const playwrightMsg =
      playwrightErr instanceof Error ? playwrightErr.message : "unknown error";

    if (useProxy && isProxyFailure(playwrightErr)) {
      activateProxyBypass(playwrightErr);
      try {
        const directResult = await scrapeWebsiteWithPlaywright(targetURL, true);
        console.info(
          `Website scrape recovered via direct mode for ${targetURL.toString()}`,
        );
        return res.json(directResult);
      } catch (directErr: unknown) {
        const directMsg =
          directErr instanceof Error ? directErr.message : "unknown error";
        console.warn(
          `Direct playwright retry failed for ${targetURL.toString()}: ${directMsg}`,
        );
      }
    } else {
      if (isExpectedSiteUnavailableError(playwrightErr)) {
        console.info(
          `Playwright scrape unavailable for ${targetURL.toString()}: ${playwrightMsg}`,
        );
      } else {
        console.warn(
          `Playwright scrape failed for ${targetURL.toString()}: ${playwrightMsg}`,
        );
      }
    }

    try {
      const fallbackResult = await scrapeWebsiteWithHTTPFallback(targetURL);
      return res.json(fallbackResult);
    } catch (fallbackErr: unknown) {
      const fallbackMsg =
        fallbackErr instanceof Error ? fallbackErr.message : "unknown error";
      if (
        isExpectedSiteUnavailableError(playwrightErr) ||
        isExpectedSiteUnavailableError(fallbackErr)
      ) {
        console.info(
          `Website unreachable or invalid for ${targetURL.toString()} (playwright/fallback failed)`,
        );
        return res.json(skippedWebsiteResponse("site_unreachable_or_invalid"));
      }

      console.error(`HTTP fallback failed for ${targetURL.toString()}: ${fallbackMsg}`);
      return res.status(500).json({ error: "website scrape failed" });
    }
  }
});

// Scrape Reclame Aqui
app.post("/scrape/reclame-aqui", async (req: Request, res: Response) => {
  const { company_name } = req.body as { company_name?: string };
  if (!company_name)
    return res.status(400).json({ error: "company_name required" });

  const attempt = async (useDirect = false) => {
    const { page, context } = useDirect
      ? await getDirectPage(randomUA())
      : await getPage(randomUA());
    try {
      const slug = company_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      await page.goto(`https://www.reclameaqui.com.br/empresa/${slug}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const notFound = await page.$('[data-testid="not-found"]').catch(() => null);
      if (notFound) {
        return {
          found: false,
          score: 0,
          solution_rate: 0,
          complaints_count: 0,
          summary: "",
        };
      }

      const score = await page
        .evaluate(() => {
          const el = document.querySelector('[data-testid="company-score"]');
          return el ? parseFloat((el.textContent || "0").replace(",", ".")) : 0;
        })
        .catch(() => 0);

      const complaintsCount = await page
        .evaluate(() => {
          const el = document.querySelector('[data-testid="complaints-count"]');
          return el ? parseInt((el.textContent || "0").replace(/\D/g, ""), 10) : 0;
        })
        .catch(() => 0);

      return {
        found: true,
        score,
        solution_rate: score / 10,
        complaints_count: complaintsCount,
        summary: `Score: ${score}/10, ${complaintsCount} reclamacoes`,
      };
    } finally {
      await context.close();
    }
  };

  const useProxy = isProxyEnabledNow();
  try {
    return res.json(await attempt(!useProxy));
  } catch (err: unknown) {
    if (useProxy && isProxyFailure(err)) {
      activateProxyBypass(err);
      try {
        const recovered = await attempt(true);
        console.info(`Reclame Aqui scrape recovered via direct mode (${company_name})`);
        return res.json(recovered);
      } catch (directErr: unknown) {
        const directMsg =
          directErr instanceof Error ? directErr.message : "unknown error";
        console.warn(`Reclame Aqui direct retry error (${company_name}): ${directMsg}`);
      }
    } else {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.warn(`Reclame Aqui scrape error (${company_name}): ${msg}`);
    }

    return res.json({
      found: false,
      score: 0,
      solution_rate: 0,
      complaints_count: 0,
      summary: "",
    });
  }
});

// Google search
app.post("/scrape/google-search", async (req: Request, res: Response) => {
  const { query, limit = 5 } = req.body as { query?: string; limit?: number };
  if (!query) return res.status(400).json({ error: "query required" });

  const attempt = async (useDirect = false) => {
    const { page, context } = useDirect
      ? await getDirectPage(randomUA())
      : await getPage(randomUA());
    try {
      const lim = Math.max(1, Math.min(limit ?? 5, 10));
      const searchURL = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${lim}`;
      await page.goto(searchURL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const results = await page.evaluate((maxCount: number) => {
        const items = document.querySelectorAll("div.g");
        return Array.from(items)
          .slice(0, maxCount)
          .map((item) => ({
            title: item.querySelector("h3")?.textContent || "",
            url: (item.querySelector("a") as HTMLAnchorElement | null)?.href || "",
            snippet: item.querySelector(".VwiC3b")?.textContent || "",
          }))
          .filter((r) => r.title && r.url);
      }, lim);

      return { results };
    } finally {
      await context.close();
    }
  };

  const useProxy = isProxyEnabledNow();
  try {
    return res.json(await attempt(!useProxy));
  } catch (err: unknown) {
    if (useProxy && isProxyFailure(err)) {
      activateProxyBypass(err);
      try {
        const recovered = await attempt(true);
        console.info(`Google search recovered via direct mode (${query})`);
        return res.json(recovered);
      } catch (directErr: unknown) {
        const directMsg =
          directErr instanceof Error ? directErr.message : "unknown error";
        console.warn(`Google search direct retry error (${query}): ${directMsg}`);
      }
    } else {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.warn(`Google search error (${query}): ${msg}`);
    }

    return res.status(500).json({ error: "google search failed" });
  }
});

initPool()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Playwright service listening on port ${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to initialize browser pool:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  console.log("Shutting down playwright-svc...");
  for (const browser of browserPool) {
    await browser.close();
  }
  if (directBrowser) {
    await directBrowser.close();
  }
  process.exit(0);
});







