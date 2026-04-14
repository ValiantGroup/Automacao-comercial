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

type WebsiteIssue = {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
};

type WebsiteContactSignals = {
  emails: string[];
  phones: string[];
  whatsapp_numbers: string[];
  addresses: string[];
  social_links: string[];
  contact_pages: string[];
};

type WebsiteHeadings = {
  h1: string[];
  h2: string[];
  h3: string[];
};

type WebsiteSiteSignals = {
  has_contact_form: boolean;
  has_whatsapp_cta: boolean;
  has_live_chat: boolean;
  has_about_page: boolean;
  has_blog: boolean;
  has_careers_page: boolean;
  has_privacy_policy: boolean;
  has_terms_page: boolean;
  has_robots_meta: boolean;
  has_favicon: boolean;
  is_https: boolean;
};

type WebsiteBusinessSignals = {
  what_company_does: string[];
  value_propositions: string[];
  target_market_hints: string[];
  location_hints: string[];
  cta_phrases: string[];
};

type WebsiteResponse = {
  title: string;
  description: string;
  text_content: string;
  text_samples: string[];
  technologies: string[];
  links: string[];
  final_url: string;
  meta_keywords: string;
  og_title: string;
  og_description: string;
  canonical_url: string;
  language: string;
  headings: WebsiteHeadings;
  contact_signals: WebsiteContactSignals;
  site_signals: WebsiteSiteSignals;
  business_signals: WebsiteBusinessSignals;
  issues: WebsiteIssue[];
  pages_count: number;
  pages_scanned: string[];
  scanned_page_summaries: Array<{
    url: string;
    title: string;
    description: string;
  }>;
  source: "playwright" | "http_fallback" | "skipped";
  skipped_reason?: string;
};

function skippedWebsiteResponse(reason: string): WebsiteResponse {
  return {
    title: "",
    description: "",
    text_content: "",
    text_samples: [],
    technologies: [],
    links: [],
    final_url: "",
    meta_keywords: "",
    og_title: "",
    og_description: "",
    canonical_url: "",
    language: "",
    headings: { h1: [], h2: [], h3: [] },
    contact_signals: {
      emails: [],
      phones: [],
      whatsapp_numbers: [],
      addresses: [],
      social_links: [],
      contact_pages: [],
    },
    site_signals: {
      has_contact_form: false,
      has_whatsapp_cta: false,
      has_live_chat: false,
      has_about_page: false,
      has_blog: false,
      has_careers_page: false,
      has_privacy_policy: false,
      has_terms_page: false,
      has_robots_meta: false,
      has_favicon: false,
      is_https: false,
    },
    business_signals: {
      what_company_does: [],
      value_propositions: [],
      target_market_hints: [],
      location_hints: [],
      cta_phrases: [],
    },
    issues: [],
    pages_count: 0,
    pages_scanned: [],
    scanned_page_summaries: [],
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
  return uniqueValues(out, 30);
}

type RawFormSignal = {
  method: string;
  action: string;
  field_count: number;
  has_email_field: boolean;
  has_tel_field: boolean;
  has_message_field: boolean;
};

type RawWebsiteExtraction = {
  title: string;
  description: string;
  text: string;
  links: string[];
  link_texts: { href: string; text: string }[];
  html: string;
  meta_keywords: string;
  og_title: string;
  og_description: string;
  canonical_url: string;
  language: string;
  final_url: string;
  headings: WebsiteHeadings;
  forms: RawFormSignal[];
  cta_texts: string[];
  has_live_chat: boolean;
  has_robots_meta: boolean;
  has_favicon: boolean;
  pages_scanned: Array<{
    url: string;
    title: string;
    description: string;
  }>;
};

function uniqueValues(values: string[], limit = 100): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawValue of values) {
    const value = normalizeSpace(rawValue);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForMatch(input: string): string {
  return stripAccents(input).toLowerCase();
}

function findTextsByKeywords(
  candidates: string[],
  keywords: string[],
  limit = 8,
): string[] {
  const out: string[] = [];
  const normalizedKeywords = keywords.map((k) => normalizeForMatch(k));
  for (const candidate of candidates) {
    const normalized = normalizeForMatch(candidate);
    if (!normalized) continue;
    if (normalizedKeywords.some((keyword) => normalized.includes(keyword))) {
      out.push(candidate);
      if (out.length >= limit) break;
    }
  }
  return uniqueValues(out, limit);
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  return uniqueValues(
    matches
      .map((value) => value.toLowerCase())
      .filter((value) => !value.endsWith(".png") && !value.endsWith(".jpg")),
    30,
  );
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return `+${digits}`;
}

function extractPhonesFromText(text: string): string[] {
  const matches =
    text.match(
      /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?\d{4,5}[\s-]?\d{4}/g,
    ) || [];
  const normalized = matches
    .map((raw) => normalizePhone(raw))
    .filter((value) => value !== "");
  return uniqueValues(normalized, 30);
}

function extractWhatsAppNumbers(text: string, links: string[]): string[] {
  const fromText =
    text.match(/(?:whatsapp|wa\.me)[^\d]*(\d{10,13})/gi)?.map((match) => {
      const onlyDigits = match.replace(/\D/g, "");
      return onlyDigits ? normalizePhone(onlyDigits) : "";
    }) || [];

  const fromLinks: string[] = [];
  for (const link of links) {
    const lower = link.toLowerCase();
    if (!lower.includes("wa.me") && !lower.includes("whatsapp")) continue;

    const paramMatch = link.match(/(?:phone=|wa\.me\/)(\d{10,13})/i);
    if (paramMatch?.[1]) {
      fromLinks.push(normalizePhone(paramMatch[1]));
    }
  }

  return uniqueValues([...fromText, ...fromLinks].filter(Boolean), 20);
}

function extractAddressHints(text: string): string[] {
  const patterns = [
    /(?:rua|avenida|av\.|travessa|rodovia|alameda|pra[çc]a)\s+[a-z0-9\s.,\-]{12,120}/gi,
    /cep[:\s-]*\d{5}-?\d{3}/gi,
  ];
  const out: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    out.push(...matches);
  }
  return uniqueValues(out, 10);
}

function extractSocialLinks(links: string[]): string[] {
  const socialDomains = [
    "linkedin.com",
    "instagram.com",
    "facebook.com",
    "youtube.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
    "threads.net",
  ];
  return uniqueValues(
    links.filter((link) =>
      socialDomains.some((domain) => link.includes(domain)),
    ),
    20,
  );
}

function normalizeLink(rawLink: string, preferredProtocol = ""): string {
  try {
    const parsed = new URL(rawLink);
    if (
      preferredProtocol &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (preferredProtocol === "http:" || preferredProtocol === "https:")
    ) {
      parsed.protocol = preferredProtocol;
    }
    parsed.hash = "";
    const utmParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ];
    utmParams.forEach((param) => parsed.searchParams.delete(param));

    // Keep path canonical to reduce duplicates like /contato and /contato/
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    return parsed.toString().trim();
  } catch {
    return rawLink.trim();
  }
}

function normalizeLinkList(links: string[], limit = 120): string[] {
  return uniqueValues(links.map((link) => normalizeLink(link)), limit);
}

function extractContactPages(links: string[]): string[] {
  const contactKeywords = [
    "contato",
    "fale-conosco",
    "faleconosco",
    "contact",
    "suporte",
    "atendimento",
  ];
  return uniqueValues(
    links.filter((link) => {
      const normalized = normalizeForMatch(link);
      return contactKeywords.some((keyword) => normalized.includes(keyword));
    }),
    15,
  );
}

function splitTextSamples(text: string, limit = 12): string[] {
  return uniqueValues(
    text
      .split(/[.!?;\n]+/)
      .map((part) => normalizeSpace(part))
      .filter((part) => part.length >= 40 && part.length <= 260)
      .filter((part) => !isLikelyNotFoundContent(part))
      .filter((part) => !isLikelyNavigationOnlyText(part)),
    limit,
  );
}

function isLikelyNotFoundContent(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const patterns = [
    "404",
    "page not found",
    "pagina nao encontrada",
    "página não encontrada",
    "oops that page cant be found",
    "oops! that page cant be found",
  ];
  return patterns.some((pattern) => normalized.includes(pattern));
}

function isLikelyNavigationOnlyText(text: string): boolean {
  const cleaned = normalizeSpace(text);
  if (!cleaned) return true;

  const normalized = normalizeForMatch(cleaned);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true;

  const navWords = [
    "home",
    "inicio",
    "menu",
    "galeria",
    "contato",
    "fale conosco",
    "sobre",
    "servicos",
    "produtos",
    "blog",
    "reservas",
    "cadastre",
    "login",
  ];
  const navHits = navWords.filter((word) => normalized.includes(word)).length;
  return navHits >= 3 && words.length <= 14;
}

function isMeaningfulBusinessSentence(text: string): boolean {
  const cleaned = normalizeSpace(text);
  if (cleaned.length < 28 || cleaned.length > 320) return false;
  if (isLikelyNotFoundContent(cleaned)) return false;
  if (isLikelyNavigationOnlyText(cleaned)) return false;

  const words = normalizeForMatch(cleaned).split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  const uniqueWordRatio = new Set(words).size / words.length;
  return uniqueWordRatio >= 0.45;
}

const STRATEGIC_INTERNAL_HINTS = [
  "sobre",
  "quem-somos",
  "empresa",
  "institucional",
  "contato",
  "fale-conosco",
  "contact",
  "servicos",
  "solucoes",
  "produtos",
  "portfolio",
  "cases",
  "depoimentos",
  "blog",
  "faq",
  "carreiras",
  "vagas",
  "trabalhe-conosco",
];

const STRATEGIC_FALLBACK_PATHS = [
  "/sobre",
  "/quem-somos",
  "/empresa",
  "/contato",
  "/fale-conosco",
  "/servicos",
  "/solucoes",
  "/produtos",
  "/portfolio",
  "/blog",
];

function isLikelyHTMLPath(pathname: string): boolean {
  const blockedExtensions = [
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".zip",
    ".rar",
    ".mp4",
    ".mp3",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
  ];
  const lower = pathname.toLowerCase();
  return !blockedExtensions.some((ext) => lower.endsWith(ext));
}

function collectStrategicInternalLinks(
  targetURL: URL,
  links: string[],
  linkTexts: { href: string; text: string }[],
  limit = 6,
): string[] {
  const scoreMap = new Map<string, number>();
  const normalizedTargetURL = normalizeLink(targetURL.toString(), targetURL.protocol);

  const scoreCandidate = (rawHref: string, anchorText = ""): void => {
    let parsed: URL;
    try {
      parsed = new URL(rawHref, targetURL);
    } catch {
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (parsed.hostname !== targetURL.hostname) return;
    if (!isLikelyHTMLPath(parsed.pathname)) return;

    parsed.search = "";
    parsed.hash = "";
    parsed.protocol = targetURL.protocol;
    const normalizedURL = normalizeLink(parsed.toString(), targetURL.protocol);
    if (!normalizedURL || normalizedURL === normalizedTargetURL) return;

    const pathAndText = normalizeForMatch(`${parsed.pathname} ${anchorText}`);
    let score = 1;
    for (const keyword of STRATEGIC_INTERNAL_HINTS) {
      if (pathAndText.includes(keyword)) score += 3;
    }
    if (parsed.pathname.split("/").filter(Boolean).length <= 2) score += 1;

    const current = scoreMap.get(normalizedURL) || 0;
    scoreMap.set(normalizedURL, Math.max(current, score));
  };

  links.forEach((href) => scoreCandidate(href));
  linkTexts.forEach((item) => scoreCandidate(item.href, item.text));

  for (const fallbackPath of STRATEGIC_FALLBACK_PATHS) {
    try {
      const fallbackURL = new URL(fallbackPath, targetURL).toString();
      scoreCandidate(fallbackURL, fallbackPath);
    } catch {
      // ignore malformed fallback URL
    }
  }

  return Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([href]) => href);
}

function mergeRawExtractions(
  base: RawWebsiteExtraction,
  extras: RawWebsiteExtraction[],
): RawWebsiteExtraction {
  const all = [base, ...extras];
  const links = normalizeLinkList(all.flatMap((item) => item.links), 280);
  const linkTexts = all
    .flatMap((item) => item.link_texts)
    .map((item) => ({
      href: normalizeLink(item.href),
      text: normalizeSpace(item.text),
    }))
    .filter((item) => item.href.startsWith("http"))
    .slice(0, 280);
  const pages: Array<{ url: string; title: string; description: string }> = [];
  const seenPageURLs = new Set<string>();
  for (const item of all) {
    for (const page of item.pages_scanned) {
      const normalizedURL = normalizeLink(page.url);
      if (!normalizedURL || seenPageURLs.has(normalizedURL)) continue;

      const title = normalizeSpace(page.title);
      const description = normalizeSpace(page.description);
      const combinedText = `${title} ${description}`;
      if (isLikelyNotFoundContent(combinedText)) continue;

      seenPageURLs.add(normalizedURL);
      pages.push({
        url: normalizedURL,
        title,
        description,
      });
      if (pages.length >= 12) break;
    }
    if (pages.length >= 12) break;
  }

  return {
    title: base.title,
    description: base.description,
    text: all.map((item) => item.text).join(" ").slice(0, 60000),
    links,
    link_texts: linkTexts,
    html: all.map((item) => item.html.slice(0, 100000)).join("\n"),
    meta_keywords: uniqueValues(all.map((item) => item.meta_keywords), 4).join(" | "),
    og_title: base.og_title,
    og_description: base.og_description,
    canonical_url: base.canonical_url,
    language: base.language,
    final_url: base.final_url,
    headings: {
      h1: uniqueValues(all.flatMap((item) => item.headings.h1), 16),
      h2: uniqueValues(all.flatMap((item) => item.headings.h2), 28),
      h3: uniqueValues(all.flatMap((item) => item.headings.h3), 36),
    },
    forms: all.flatMap((item) => item.forms).slice(0, 30),
    cta_texts: uniqueValues(all.flatMap((item) => item.cta_texts), 120),
    has_live_chat: all.some((item) => item.has_live_chat),
    has_robots_meta: all.some((item) => item.has_robots_meta),
    has_favicon: all.some((item) => item.has_favicon),
    pages_scanned: pages,
  };
}

function detectBusinessSignals(
  title: string,
  description: string,
  textSamples: string[],
  headings: WebsiteHeadings,
  ctaPhrases: string[],
  addresses: string[],
): WebsiteBusinessSignals {
  const businessCandidates = uniqueValues([
    description,
    ...headings.h1,
    ...headings.h2,
    ...textSamples,
  ]).filter((candidate) => isMeaningfulBusinessSentence(candidate));

  const curatedCTA = uniqueValues(ctaPhrases, 24).filter((candidate) =>
    isMeaningfulBusinessSentence(candidate),
  );

  const whatCompanyDoes = findTextsByKeywords(
    businessCandidates,
    [
      "solu",
      "servi",
      "plataforma",
      "software",
      "consultoria",
      "especializada",
      "atua",
      "oferece",
      "gestao",
      "automacao",
      "digital",
      "industria",
      "saude",
      "varejo",
      "logistica",
      "financeiro",
    ],
    6,
  );
  if (
    whatCompanyDoes.length === 0 &&
    description &&
    isMeaningfulBusinessSentence(description)
  ) {
    whatCompanyDoes.push(description);
  }
  if (
    whatCompanyDoes.length === 0 &&
    title &&
    isMeaningfulBusinessSentence(title)
  ) {
    whatCompanyDoes.push(title);
  }

  const valuePropositions = findTextsByKeywords(
    [...businessCandidates, ...curatedCTA, description],
    [
      "reduz",
      "aumenta",
      "otimiz",
      "econom",
      "eficien",
      "produt",
      "resultado",
      "cres",
      "escala",
      "agilidade",
      "performance",
    ],
    6,
  );

  const targetMarketHints = findTextsByKeywords(
    [...businessCandidates, ...headings.h2, ...headings.h3, title].filter((v) =>
      isMeaningfulBusinessSentence(v),
    ),
    [
      "b2b",
      "b2c",
      "empresas",
      "industria",
      "comercio",
      "varejo",
      "hospital",
      "clinica",
      "escola",
      "restaurante",
      "logistica",
      "construcao",
      "juridico",
      "contabil",
      "agronegocio",
    ],
    8,
  );

  const locationHints = uniqueValues([
    ...addresses,
    ...findTextsByKeywords(
      [...businessCandidates, ...headings.h2, ...headings.h3].filter((v) =>
        isMeaningfulBusinessSentence(v),
      ),
      [
        "sao paulo",
        "rio de janeiro",
        "minas gerais",
        "parana",
        "santa catarina",
        "porto alegre",
        "curitiba",
        "belo horizonte",
        "brasil",
      ],
      6,
    ),
  ]);

  return {
    what_company_does: uniqueValues(whatCompanyDoes, 6),
    value_propositions: valuePropositions,
    target_market_hints: targetMarketHints,
    location_hints: locationHints,
    cta_phrases: uniqueValues(curatedCTA, 12),
  };
}

function detectWebsiteIssues(
  targetURL: URL,
  data: {
    title: string;
    description: string;
    textContent: string;
    headings: WebsiteHeadings;
    contactSignals: WebsiteContactSignals;
    siteSignals: WebsiteSiteSignals;
  },
): WebsiteIssue[] {
  const issues: WebsiteIssue[] = [];

  if (!data.title) {
    issues.push({
      code: "missing_title",
      severity: "high",
      message: "Pagina sem title definido.",
    });
  } else if (data.title.length < 20 || data.title.length > 70) {
    issues.push({
      code: "title_length",
      severity: "low",
      message: "Title fora da faixa recomendada de SEO (20-70 caracteres).",
    });
  }

  if (!data.description) {
    issues.push({
      code: "missing_meta_description",
      severity: "medium",
      message: "Pagina sem meta description.",
    });
  } else if (data.description.length < 60) {
    issues.push({
      code: "short_meta_description",
      severity: "low",
      message: "Meta description curta, com pouco contexto comercial.",
    });
  }

  if (data.headings.h1.length === 0) {
    issues.push({
      code: "missing_h1",
      severity: "medium",
      message: "Nenhum H1 encontrado na pagina principal.",
    });
  }

  if (data.textContent.length < 300) {
    issues.push({
      code: "low_text_content",
      severity: "medium",
      message: "Conteudo textual limitado para comunicar proposta de valor.",
    });
  }

  const hasContactChannel =
    data.contactSignals.emails.length > 0 ||
    data.contactSignals.phones.length > 0 ||
    data.contactSignals.whatsapp_numbers.length > 0 ||
    data.contactSignals.contact_pages.length > 0;
  if (!hasContactChannel) {
    issues.push({
      code: "missing_contact_channels",
      severity: "high",
      message: "Nao foram detectados canais de contato claros no site.",
    });
  }

  if (!data.siteSignals.has_privacy_policy && data.siteSignals.has_contact_form) {
    issues.push({
      code: "missing_privacy_policy",
      severity: "medium",
      message: "Formulario presente sem evidencia de politica de privacidade.",
    });
  }

  if (targetURL.protocol !== "https:") {
    issues.push({
      code: "insecure_http",
      severity: "high",
      message: "Site principal em HTTP sem HTTPS.",
    });
  }

  return issues.slice(0, 12);
}

function buildWebsiteResponse(
  targetURL: URL,
  source: "playwright" | "http_fallback",
  raw: RawWebsiteExtraction,
): WebsiteResponse {
  const textContent = normalizeSpace(raw.text).slice(0, 12000);
  const links = normalizeLinkList(raw.links, 140);
  const allTextForSignals = normalizeSpace(
    `${textContent} ${raw.html} ${raw.cta_texts.join(" ")}`,
  );

  const emails = extractEmailsFromText(allTextForSignals);
  const phones = extractPhonesFromText(allTextForSignals);
  const whatsappNumbers = extractWhatsAppNumbers(allTextForSignals, links);
  const addresses = extractAddressHints(allTextForSignals);
  const socialLinks = extractSocialLinks(links);
  const contactPages = extractContactPages(links);

  const siteSignals: WebsiteSiteSignals = {
    has_contact_form: raw.forms.some(
      (form) =>
        form.field_count >= 2 &&
        (form.has_email_field || form.has_tel_field || form.has_message_field),
    ),
    has_whatsapp_cta:
      whatsappNumbers.length > 0 ||
      links.some((link) => normalizeForMatch(link).includes("whatsapp")),
    has_live_chat: raw.has_live_chat,
    has_about_page: links.some((link) =>
      ["sobre", "about", "quem-somos"].some((keyword) =>
        normalizeForMatch(link).includes(keyword),
      ),
    ),
    has_blog: links.some((link) =>
      ["blog", "artigos", "conteudo"].some((keyword) =>
        normalizeForMatch(link).includes(keyword),
      ),
    ),
    has_careers_page: links.some((link) =>
      ["carreira", "carreiras", "jobs", "vagas", "trabalhe-conosco"].some(
        (keyword) => normalizeForMatch(link).includes(keyword),
      ),
    ),
    has_privacy_policy: links.some((link) =>
      ["privacidade", "privacy", "lgpd"].some((keyword) =>
        normalizeForMatch(link).includes(keyword),
      ),
    ),
    has_terms_page: links.some((link) =>
      ["termos", "terms", "condicoes", "condicoes-de-uso"].some((keyword) =>
        normalizeForMatch(link).includes(keyword),
      ),
    ),
    has_robots_meta: raw.has_robots_meta,
    has_favicon: raw.has_favicon,
    is_https: targetURL.protocol === "https:",
  };

  const textSamples = splitTextSamples(textContent, 16);
  const businessSignals = detectBusinessSignals(
    raw.title,
    raw.description,
    textSamples,
    raw.headings,
    raw.cta_texts,
    addresses,
  );

  const contactSignals: WebsiteContactSignals = {
    emails,
    phones,
    whatsapp_numbers: whatsappNumbers,
    addresses,
    social_links: socialLinks,
    contact_pages: contactPages,
  };

  const issues = detectWebsiteIssues(targetURL, {
    title: normalizeSpace(raw.title),
    description: normalizeSpace(raw.description),
    textContent,
    headings: raw.headings,
    contactSignals,
    siteSignals,
  });

  const cleanScannedPages: Array<{ url: string; title: string; description: string }> =
    [];
  const seenScannedURLs = new Set<string>();
  for (const page of raw.pages_scanned) {
    const normalizedURL = normalizeLink(page.url, targetURL.protocol);
    if (!normalizedURL || seenScannedURLs.has(normalizedURL)) continue;

    const title = normalizeSpace(page.title);
    const description = normalizeSpace(page.description);
    const combined = `${title} ${description}`;
    if (isLikelyNotFoundContent(combined)) continue;

    seenScannedURLs.add(normalizedURL);
    cleanScannedPages.push({
      url: normalizedURL,
      title,
      description,
    });
    if (cleanScannedPages.length >= 12) break;
  }

  return {
    title: normalizeSpace(raw.title),
    description: normalizeSpace(raw.description),
    text_content: textContent,
    text_samples: textSamples,
    technologies: detectTechnologiesFromContent(raw.html + " " + textContent),
    links,
    final_url: raw.final_url || targetURL.toString(),
    meta_keywords: normalizeSpace(raw.meta_keywords),
    og_title: normalizeSpace(raw.og_title),
    og_description: normalizeSpace(raw.og_description),
    canonical_url: normalizeSpace(raw.canonical_url),
    language: normalizeSpace(raw.language),
    headings: {
      h1: uniqueValues(raw.headings.h1, 8),
      h2: uniqueValues(raw.headings.h2, 16),
      h3: uniqueValues(raw.headings.h3, 20),
    },
    contact_signals: contactSignals,
    site_signals: siteSignals,
    business_signals: businessSignals,
    issues,
    pages_count: cleanScannedPages.length,
    pages_scanned: cleanScannedPages.map((page) => page.url),
    scanned_page_summaries: cleanScannedPages,
    source,
  };
}

async function extractRawWebsiteFromCurrentPage(
  page: Page,
): Promise<RawWebsiteExtraction> {
  return page.evaluate(() => {
    const title = document.title || "";
    const description =
      (
        document.querySelector('meta[name="description"]') as
          | HTMLMetaElement
          | null
      )?.content || "";

    const metaKeywords =
      (
        document.querySelector('meta[name="keywords"]') as
          | HTMLMetaElement
          | null
      )?.content || "";

    const ogTitle =
      (
        document.querySelector('meta[property="og:title"]') as
          | HTMLMetaElement
          | null
      )?.content || "";
    const ogDescription =
      (
        document.querySelector('meta[property="og:description"]') as
          | HTMLMetaElement
          | null
      )?.content || "";
    const canonicalURL =
      (
        document.querySelector('link[rel="canonical"]') as
          | HTMLLinkElement
          | null
      )?.href || "";

    const body = document.body;
    let text = "";
    if (body) {
      const preferredRoots = Array.from(
        document.querySelectorAll("main, article, section"),
      ).slice(0, 18);
      const elements =
        preferredRoots.length > 0
          ? preferredRoots.flatMap((root) =>
              Array.from(root.querySelectorAll("p, h1, h2, h3, li")),
            )
          : Array.from(body.querySelectorAll("p, h1, h2, h3, li"));
      text = Array.from(elements)
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean)
        .slice(0, 420)
        .join(" ");
    }

    const linkElements = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => anchor as HTMLAnchorElement)
      .filter((anchor) => anchor.href.startsWith("http"));
    const links = linkElements.map((anchor) => anchor.href).slice(0, 220);
    const linkTexts = linkElements
      .map((anchor) => ({
        href: anchor.href,
        text: (anchor.textContent || "").trim(),
      }))
      .slice(0, 220);

    const headings = {
      h1: Array.from(document.querySelectorAll("h1"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 12),
      h2: Array.from(document.querySelectorAll("h2"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 24),
      h3: Array.from(document.querySelectorAll("h3"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 28),
    };

    const forms = Array.from(document.querySelectorAll("form"))
      .map((form) => {
        const method = form.getAttribute("method") || "";
        const action = form.getAttribute("action") || "";
        const fields = Array.from(form.querySelectorAll("input, textarea, select"));
        return {
          method,
          action,
          field_count: fields.length,
          has_email_field: !!form.querySelector('input[type="email"]'),
          has_tel_field: !!form.querySelector('input[type="tel"]'),
          has_message_field:
            !!form.querySelector("textarea") ||
            fields.some((field) =>
              (field.getAttribute("name") || "").toLowerCase().includes("message"),
            ),
        };
      })
      .slice(0, 16);

    const ctaTexts = Array.from(
      document.querySelectorAll("button, a, input[type='submit']"),
    )
      .map((el) => (el.textContent || (el as HTMLInputElement).value || "").trim())
      .filter((value) => value.length >= 4 && value.length <= 80)
      .slice(0, 80);

    const html = (document.documentElement?.outerHTML || "").slice(0, 250000);
    const hasLiveChat = Boolean(
      document.querySelector(
        '[id*="chat"], [class*="chat"], [id*="intercom"], [class*="intercom"], [id*="drift"], [class*="drift"]',
      ),
    );

    return {
      title,
      description,
      text,
      links,
      link_texts: linkTexts,
      html,
      meta_keywords: metaKeywords,
      og_title: ogTitle,
      og_description: ogDescription,
      canonical_url: canonicalURL,
      language: document.documentElement?.lang || "",
      final_url: window.location.href,
      headings,
      forms,
      cta_texts: ctaTexts,
      has_live_chat: hasLiveChat,
      has_robots_meta: !!document.querySelector('meta[name="robots"]'),
      has_favicon: !!document.querySelector('link[rel*="icon"]'),
      pages_scanned: [
        {
          url: window.location.href,
          title: (document.title || "").trim(),
          description: description.trim(),
        },
      ],
    };
  });
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
    let pageData: RawWebsiteExtraction | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page
          .waitForLoadState("domcontentloaded", { timeout: 10_000 })
          .catch(() => {});
        if (attempt > 0) {
          await page.waitForTimeout(250);
        }
        pageData = await extractRawWebsiteFromCurrentPage(page);
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
    const strategicLinks = collectStrategicInternalLinks(
      targetURL,
      pageData.links,
      pageData.link_texts,
      8,
    );
    const extractions: RawWebsiteExtraction[] = [];

    for (const strategicURL of strategicLinks) {
      try {
        await page.goto(strategicURL, {
          waitUntil: "domcontentloaded",
          timeout: 18_000,
        });
        await page
          .waitForLoadState("domcontentloaded", { timeout: 6_000 })
          .catch(() => {});
        const data = await extractRawWebsiteFromCurrentPage(page);
        const combined = normalizeSpace(
          `${data.title} ${data.description} ${data.text.slice(0, 4000)}`,
        );
        if (isLikelyNotFoundContent(combined)) {
          continue;
        }
        extractions.push(data);
      } catch {
        // continue crawling other candidate internal pages
      }
    }

    const merged = mergeRawExtractions(pageData, extractions);
    return buildWebsiteResponse(targetURL, "playwright", merged);
  } finally {
    await context.close();
  }
}

function extractMetaContentByName(html: string, name: string): string {
  const m = html.match(
    new RegExp(
      `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
  );
  if (m?.[1]) return normalizeSpace(decodeHtmlEntities(m[1]));
  const m2 = html.match(
    new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`,
      "i",
    ),
  );
  return m2?.[1] ? normalizeSpace(decodeHtmlEntities(m2[1])) : "";
}

function extractMetaContentByProperty(html: string, property: string): string {
  const m = html.match(
    new RegExp(
      `<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i",
    ),
  );
  if (m?.[1]) return normalizeSpace(decodeHtmlEntities(m[1]));
  const m2 = html.match(
    new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["'][^>]*>`,
      "i",
    ),
  );
  return m2?.[1] ? normalizeSpace(decodeHtmlEntities(m2[1])) : "";
}

function extractCanonicalURL(html: string): string {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  if (m?.[1]) return normalizeSpace(decodeHtmlEntities(m[1]));
  const m2 = html.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return m2?.[1] ? normalizeSpace(decodeHtmlEntities(m2[1])) : "";
}

function extractLanguage(html: string): string {
  const m = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
  return m?.[1] ? normalizeSpace(m[1]) : "";
}

function extractHeadingsByTag(html: string, tag: "h1" | "h2" | "h3", limit: number): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const cleaned = normalizeSpace(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ")));
    if (cleaned) out.push(cleaned);
    if (out.length >= limit) break;
    match = regex.exec(html);
  }
  return uniqueValues(out, limit);
}

function extractCTATextsFromHTML(html: string): string[] {
  const regex = /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi;
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const cleaned = normalizeSpace(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ")));
    if (cleaned.length >= 4 && cleaned.length <= 80) {
      out.push(cleaned);
    }
    if (out.length >= 60) break;
    match = regex.exec(html);
  }
  return uniqueValues(out, 60);
}

function parseFormsFromHTML(html: string): RawFormSignal[] {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  return forms.slice(0, 10).map((form) => {
    const method = (form.match(/method=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const action = form.match(/action=["']([^"']+)["']/i)?.[1] || "";
    const fieldCount = (form.match(/<(?:input|textarea|select)\b/gi) || []).length;
    return {
      method,
      action,
      field_count: fieldCount,
      has_email_field: /input[^>]*type=["']email["']/i.test(form),
      has_tel_field: /input[^>]*type=["']tel["']/i.test(form),
      has_message_field: /textarea/i.test(form) || /name=["'][^"']*message/i.test(form),
    };
  });
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
    const textContent = stripHtmlToText(html).slice(0, 12000);
    const links = extractLinks(html, finalURL);

    const raw: RawWebsiteExtraction = {
      title,
      description,
      text: textContent,
      links,
      link_texts: links.map((href) => ({ href, text: "" })),
      html,
      meta_keywords: extractMetaContentByName(html, "keywords"),
      og_title: extractMetaContentByProperty(html, "og:title"),
      og_description: extractMetaContentByProperty(html, "og:description"),
      canonical_url: extractCanonicalURL(html),
      language: extractLanguage(html),
      final_url: finalURL.toString(),
      headings: {
        h1: extractHeadingsByTag(html, "h1", 8),
        h2: extractHeadingsByTag(html, "h2", 16),
        h3: extractHeadingsByTag(html, "h3", 20),
      },
      forms: parseFormsFromHTML(html),
      cta_texts: extractCTATextsFromHTML(html),
      has_live_chat: /intercom|drift|zendesk|tawk|chatwoot|jivochat/i.test(html),
      has_robots_meta: /<meta[^>]*name=["']robots["']/i.test(html),
      has_favicon: /<link[^>]*rel=["'][^"']*icon/i.test(html),
      pages_scanned: [
        {
          url: finalURL.toString(),
          title,
          description,
        },
      ],
    };

    return buildWebsiteResponse(targetURL, "http_fallback", raw);
  } finally {
    clearTimeout(timeout);
  }
}

type ReclameAquiResponse = {
  found: boolean;
  company_name: string;
  company_slug: string;
  profile_url: string;
  score: number;
  solution_rate: number;
  complaints_count: number;
  responded_percentage: number | null;
  would_do_business_again_percentage: number | null;
  consumer_score: number | null;
  response_time_text: string;
  response_time_days: number | null;
  complaint_topics: string[];
  recent_complaints: string[];
  indicators: Record<string, string>;
  summary: string;
};

function parseLocaleFloat(raw: string): number | null {
  const normalized = normalizeSpace(raw).replace("%", "").replace(",", ".");
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseLooseInteger(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

function extractFirstNumber(
  text: string,
  patterns: RegExp[],
): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseLocaleFloat(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function extractFirstInteger(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseLooseInteger(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function parseResponseTimeToDays(raw: string): number | null {
  const value = parseLocaleFloat(raw);
  if (value === null) return null;
  const normalized = normalizeForMatch(raw);
  if (normalized.includes("hora")) return Number((value / 24).toFixed(2));
  if (normalized.includes("min")) return Number((value / 1440).toFixed(2));
  return value;
}

function deriveReclameAquiTopics(text: string, complaints: string[]): string[] {
  const corpus = normalizeForMatch(`${text} ${complaints.join(" ")}`);
  const topicRules = [
    { label: "atraso na entrega", keys: ["atras", "entrega", "prazo"] },
    { label: "atendimento e suporte", keys: ["atendimento", "suporte", "sac"] },
    { label: "cobranca e pagamento", keys: ["cobranca", "pagamento", "fatura", "boleto"] },
    { label: "cancelamento e reembolso", keys: ["cancel", "reembolso", "estorno"] },
    { label: "qualidade do produto/servico", keys: ["defeito", "qualidade", "nao funciona"] },
    { label: "acesso e login", keys: ["login", "acesso", "senha", "app"] },
  ];

  const out: string[] = [];
  for (const rule of topicRules) {
    if (rule.keys.some((key) => corpus.includes(key))) {
      out.push(rule.label);
    }
  }
  return uniqueValues(out, 8);
}

function emptyReclameAquiResponse(): ReclameAquiResponse {
  return {
    found: false,
    company_name: "",
    company_slug: "",
    profile_url: "",
    score: 0,
    solution_rate: 0,
    complaints_count: 0,
    responded_percentage: null,
    would_do_business_again_percentage: null,
    consumer_score: null,
    response_time_text: "",
    response_time_days: null,
    complaint_topics: [],
    recent_complaints: [],
    indicators: {},
    summary: "",
  };
}

function sanitizeReclameAquiSlug(companyName: string): string {
  return normalizeForMatch(companyName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeReclameAquiProfileURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL, "https://www.reclameaqui.com.br");
    const match = parsed.pathname.match(/\/empresa\/([^/]+)/i);
    if (!match?.[1]) return "";
    return `https://www.reclameaqui.com.br/empresa/${match[1]}/`;
  } catch {
    return "";
  }
}

function extractReclameAquiSlugFromURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL);
    const match = parsed.pathname.match(/\/empresa\/([^/]+)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

async function isReclameAquiNotFound(page: Page): Promise<boolean> {
  const currentURL = page.url().toLowerCase();
  if (currentURL.includes("/404") || currentURL.includes("/nao-encontrado")) {
    return true;
  }

  const notFoundBySelector = await page.$('[data-testid="not-found"]').catch(() => null);
  if (notFoundBySelector) return true;

  const notFoundByText = await page
    .evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      return (
        text.includes("pagina nao encontrada") ||
        text.includes("página não encontrada") ||
        text.includes("empresa nao encontrada") ||
        text.includes("não encontramos")
      );
    })
    .catch(() => false);
  return Boolean(notFoundByText);
}

async function resolveReclameAquiProfileURL(
  page: Page,
  companyName: string,
): Promise<string> {
  const slug = sanitizeReclameAquiSlug(companyName);
  if (slug) {
    const directURL = `https://www.reclameaqui.com.br/empresa/${slug}/`;
    await page.goto(directURL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!(await isReclameAquiNotFound(page))) {
      return normalizeReclameAquiProfileURL(page.url()) || directURL;
    }
  }

  const searchURL = `https://www.reclameaqui.com.br/busca/?q=${encodeURIComponent(
    companyName,
  )}`;
  await page.goto(searchURL, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const candidate = await page
    .evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/empresa/"]'),
      ) as HTMLAnchorElement[];
      const best = anchors
        .map((a) => a.href)
        .find((href) => href.includes("/empresa/"));
      return best || "";
    })
    .catch(() => "");

  if (!candidate) return "";
  const normalized = normalizeReclameAquiProfileURL(candidate);
  if (!normalized) return "";

  await page.goto(normalized, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (await isReclameAquiNotFound(page)) {
    return "";
  }
  return normalized;
}

async function scrapeRecentReclameAquiComplaints(
  page: Page,
  profileURL: string,
): Promise<string[]> {
  const listURL = `${profileURL.replace(/\/+$/, "")}/lista-reclamacoes/`;
  try {
    await page.goto(listURL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const titles = await page.evaluate(() => {
      const titleCandidates = Array.from(
        document.querySelectorAll('a[href*="/reclamacao/"], h3, h4'),
      )
        .map((el) => (el.textContent || "").trim())
        .filter((text) => text.length >= 12 && text.length <= 180);
      return titleCandidates.slice(0, 30);
    });

    return uniqueValues(titles, 15);
  } catch {
    return [];
  }
}

function buildReclameAquiSummary(data: {
  score: number;
  solutionRate: number;
  complaintsCount: number;
  respondedPercentage: number | null;
  complaintTopics: string[];
}): string {
  const parts = [
    `Nota ${data.score.toFixed(1)}/10`,
    `indice de solucao ${(data.solutionRate * 100).toFixed(0)}%`,
    `${data.complaintsCount} reclamacoes`,
  ];
  if (data.respondedPercentage !== null) {
    parts.push(`${data.respondedPercentage.toFixed(0)}% respondidas`);
  }
  if (data.complaintTopics.length > 0) {
    parts.push(`topicos: ${data.complaintTopics.slice(0, 3).join(", ")}`);
  }
  return parts.join(", ");
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

  const attempt = async (useDirect = false): Promise<ReclameAquiResponse> => {
    const { page, context } = useDirect
      ? await getDirectPage(randomUA())
      : await getPage(randomUA());
    try {
      const profileURL = await resolveReclameAquiProfileURL(page, company_name);
      if (!profileURL) {
        return emptyReclameAquiResponse();
      }

      const profileData = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const lines = (document.body?.innerText || "")
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter((line) => line.length >= 4 && line.length <= 160);
        const indicatorLines = lines
          .filter(
            (line) =>
              /reclama|solu|respost|consumidor|voltariam|negocio|tempo/i.test(line) &&
              /[0-9]/.test(line),
          )
          .slice(0, 30);

        const complaintTitles = Array.from(
          document.querySelectorAll('a[href*="/reclamacao/"]'),
        )
          .map((el) => (el.textContent || "").trim())
          .filter((text) => text.length >= 12 && text.length <= 180)
          .slice(0, 15);

        return {
          body_text: bodyText,
          company_name: (document.querySelector("h1")?.textContent || "").trim(),
          score_text: (
            document.querySelector('[data-testid="company-score"]')?.textContent || ""
          ).trim(),
          indicator_lines: indicatorLines,
          complaint_titles: complaintTitles,
        };
      });

      const scoreFromText =
        parseLocaleFloat(profileData.score_text) ??
        extractFirstNumber(profileData.body_text, [
          /([0-9]{1,2}(?:[,.][0-9]+)?)\s*\/\s*10/i,
          /nota[^0-9]{0,20}([0-9]{1,2}(?:[,.][0-9]+)?)/i,
        ]) ??
        0;
      const score = Math.max(0, Math.min(scoreFromText, 10));

      const complaintsCount =
        extractFirstInteger(profileData.body_text, [
          /([0-9][0-9\.\,]*)\s+reclama[cç][aã]o(?:es|s)?/i,
          /reclama[cç][aã]o(?:es|s)?[^0-9]{0,20}([0-9][0-9\.\,]*)/i,
        ]) ?? 0;

      const solutionPercent = extractFirstNumber(profileData.body_text, [
        /([0-9]{1,3}(?:[,.][0-9]+)?)%\s*(?:de\s*)?(?:solu[cç][aã]o|solucionad)/i,
        /indice de solu[cç][aã]o[^0-9]{0,20}([0-9]{1,3}(?:[,.][0-9]+)?)/i,
      ]);
      const respondedPercentage = extractFirstNumber(profileData.body_text, [
        /([0-9]{1,3}(?:[,.][0-9]+)?)%\s*respondid/i,
        /respondid[ao]s?[^0-9]{0,20}([0-9]{1,3}(?:[,.][0-9]+)?)/i,
      ]);
      const wouldDoBusinessAgainPercentage = extractFirstNumber(profileData.body_text, [
        /([0-9]{1,3}(?:[,.][0-9]+)?)%\s*(?:voltariam|voltaria|fariam negocio novamente)/i,
        /voltariam a fazer negocio[^0-9]{0,20}([0-9]{1,3}(?:[,.][0-9]+)?)/i,
      ]);
      const consumerScore = extractFirstNumber(profileData.body_text, [
        /nota do consumidor[^0-9]{0,20}([0-9]{1,2}(?:[,.][0-9]+)?)/i,
      ]);

      const responseTimeText =
        profileData.body_text.match(
          /(?:tempo medio de resposta|tempo de resposta|responde em)[^0-9]{0,20}([0-9]{1,3}(?:[,.][0-9]+)?\s*(?:dias?|horas?|minutos?))/i,
        )?.[1] || "";
      const responseTimeDays = responseTimeText
        ? parseResponseTimeToDays(responseTimeText)
        : null;

      const recentFromList = await scrapeRecentReclameAquiComplaints(page, profileURL);
      const recentComplaints = uniqueValues(
        [...profileData.complaint_titles, ...recentFromList],
        15,
      );
      const complaintTopics = deriveReclameAquiTopics(
        profileData.body_text,
        recentComplaints,
      );

      const indicators: Record<string, string> = {};
      if (respondedPercentage !== null) {
        indicators.responded_percentage = `${respondedPercentage.toFixed(1)}%`;
      }
      if (wouldDoBusinessAgainPercentage !== null) {
        indicators.would_do_business_again_percentage = `${wouldDoBusinessAgainPercentage.toFixed(
          1,
        )}%`;
      }
      if (consumerScore !== null) {
        indicators.consumer_score = consumerScore.toFixed(1);
      }
      if (responseTimeText) {
        indicators.response_time = responseTimeText;
      }
      profileData.indicator_lines.slice(0, 10).forEach((line, index) => {
        indicators[`line_${index + 1}`] = line;
      });

      const solutionRate =
        solutionPercent !== null
          ? Math.max(0, Math.min(solutionPercent, 100)) / 100
          : Math.max(0, Math.min(score / 10, 1));

      const summary = buildReclameAquiSummary({
        score,
        solutionRate,
        complaintsCount,
        respondedPercentage,
        complaintTopics,
      });

      return {
        found: true,
        company_name: profileData.company_name || company_name,
        company_slug: extractReclameAquiSlugFromURL(profileURL),
        profile_url: profileURL,
        score,
        solution_rate: solutionRate,
        complaints_count: complaintsCount,
        responded_percentage: respondedPercentage,
        would_do_business_again_percentage: wouldDoBusinessAgainPercentage,
        consumer_score: consumerScore,
        response_time_text: responseTimeText,
        response_time_days: responseTimeDays,
        complaint_topics: complaintTopics,
        recent_complaints: recentComplaints,
        indicators,
        summary,
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

    return res.json(emptyReclameAquiResponse());
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







