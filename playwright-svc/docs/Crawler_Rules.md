# Análise funcional do `src/server.ts`

## Visão geral
O arquivo implementa um serviço HTTP em Express que usa Playwright (com pool de browsers e suporte a proxy) para:
- Fazer scraping completo de websites (`/scrape/website`)
- Coletar sinais de reputação no Reclame Aqui (`/scrape/reclame-aqui`)
- Buscar resultados no Google (`/scrape/google-search`)
- Expor saúde da aplicação (`/health`)

Ele também inclui validações de segurança (bloqueio de URL privada/SSRF), extração de sinais comerciais e plano de contingência (fallback HTTP sem navegador).

## Estruturas principais e função de cada uma

### 1. Bootstrap e middleware
- `app`, `express.json()`: inicializa API e parse de JSON.
- `isJSONBodyParseError` + middleware de erro: intercepta JSON inválido e responde `400 invalid json body`.

### 2. Configuração e constantes
- `PORT`, `PROXY_URL`, `PROXY_BYPASS_MS`: parâmetros operacionais via env.
- `USER_AGENTS`: rotação de user-agent para reduzir bloqueios.
- `UNSUPPORTED_HOST_SUFFIXES`: hosts que não serão rastreados (ex.: redes sociais).

### 3. Tipos de dados
Define contratos de saída para manter resposta estruturada:
- `WebsiteResponse` e subtipos (`WebsiteHeadings`, `WebsiteContactSignals`, `WebsiteSiteSignals`, `WebsiteBusinessSignals`, `WebsiteIssue`)
- `RawWebsiteExtraction`: formato bruto capturado da página antes de normalizar.
- `ReclameAquiResponse`: formato final para dados de reputação.

### 4. Resposta de “skip”
- `skippedWebsiteResponse(reason)`: retorna payload padrão quando o site não pode/ não deve ser processado.

### 5. Pool de browsers e fallback direto
- `initPool`, `getPage`: cria e usa pool round-robin de instâncias Playwright.
- `getDirectBrowser`, `getDirectPage`: browser separado sem proxy para contingência.
- `isProxyEnabledNow`, `activateProxyBypass`: desativa proxy temporariamente após falhas de proxy.

### 6. Classificadores de erro
- `isProxyFailure`: detecta erros típicos de proxy.
- `isExecutionContextDestroyed`: trata erro transitório de navegação do Playwright.
- `isExpectedSiteUnavailableError`: identifica indisponibilidade esperada (DNS, timeout, SSL, 4xx/5xx etc.) para evitar 500 desnecessário.

### 7. Segurança de URL (anti-SSRF)
- `ensurePublicURL`: aceita só `http/https`, bloqueia localhost/domínios internos e IPs privados (IPv4/IPv6), incluindo validação DNS.
- `hostIsUnsupported`: rejeita domínios fora do escopo (lista de sufixos não suportados).

### 8. Utilitários de parsing e normalização
Conjunto de funções para limpar e extrair dados:
- Decodificação/limpeza: `decodeHtmlEntities`, `normalizeSpace`, `stripHtmlToText`, `normalizeLink`.
- Extrações básicas: links, meta tags, headings, CTAs, formulários, idioma, canonical.
- Deduplicação e matching: `uniqueValues`, `normalizeForMatch`, `findTextsByKeywords`.

### 9. Extração de sinais comerciais
- Contato: `extractEmailsFromText`, `extractPhonesFromText`, `extractWhatsAppNumbers`, `extractAddressHints`, `extractSocialLinks`, `extractContactPages`.
- Conteúdo: `splitTextSamples`, filtros de ruído (`isLikelyNotFoundContent`, `isLikelyNavigationOnlyText`).
- Negócio: `detectBusinessSignals` (o que a empresa faz, proposta de valor, mercado-alvo, localização, CTAs).
- Qualidade/SEO/compliance: `detectWebsiteIssues` (title, description, H1, volume de texto, canais de contato, privacidade, HTTPS).

### 10. Estratégia de crawl interno
- `collectStrategicInternalLinks`: escolhe páginas internas relevantes (sobre, contato, serviços, blog etc.) por score.
- `mergeRawExtractions`: une página principal + páginas estratégicas para enriquecer a análise.
- `buildWebsiteResponse`: transforma extração bruta em resposta final com sinais, issues e resumo de páginas varridas.

### 11. Mecanismos de scraping
- `extractRawWebsiteFromCurrentPage`: captura DOM no browser (Playwright).
- `scrapeWebsiteWithPlaywright`: fluxo principal de scraping, com retries e crawl interno estratégico.
- `scrapeWebsiteWithHTTPFallback`: fallback sem browser via `fetch` + parsing por regex quando Playwright falha.

### 12. Bloco Reclame Aqui
- Resolve perfil (`resolveReclameAquiProfileURL`) por slug direto e busca.
- Detecta “não encontrado” (`isReclameAquiNotFound`).
- Extrai métricas (nota, índice de solução, volume de reclamações, tempos, tópicos).
- Normaliza números (`parseLocaleFloat`, `parseLooseInteger`, etc.) e monta resumo (`buildReclameAquiSummary`).

## Fluxo funcional ponta a ponta

### Inicialização
1. `initPool()` cria pool de browsers.
2. `app.listen(PORT)` sobe o serviço.
3. Em `SIGTERM`, fecha todos os browsers e encerra processo.

### Fluxo `/scrape/website`
1. Valida body (`url`) e sanitiza com `ensurePublicURL`.
2. Bloqueia host não suportado com resposta `skipped`.
3. Tenta Playwright (proxy ou direto, conforme estado do bypass).
4. Em erro de proxy: ativa bypass temporário e tenta modo direto.
5. Se Playwright falhar: tenta `scrapeWebsiteWithHTTPFallback`.
6. Se ambos falharem por indisponibilidade esperada: retorna `skipped`.
7. Se falha inesperada total: retorna `500 website scrape failed`.

### Fluxo `/scrape/reclame-aqui`
1. Valida `company_name`.
2. Tenta scraping com Playwright (proxy/direto).
3. Em falha de proxy: ativa bypass e retenta direto.
4. Em falha final: retorna objeto vazio (`found: false`) em vez de erro crítico.

### Fluxo `/scrape/google-search`
1. Valida `query` e limita `limit` entre 1 e 10.
2. Faz busca na SERP com Playwright e extrai `title/url/snippet`.
3. Em falha de proxy: bypass + retry direto.
4. Em falha final: `500 google search failed`.

### Fluxo `/health`
Retorna estado operacional: tamanho do pool, status do proxy e tempo restante de bypass.
