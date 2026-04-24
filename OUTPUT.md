# Análise do fluxo: Google Maps -> Reclame Aqui -> Banco -> Responses

## 1) Onde a descoberta começa (Google Maps)
Entrada principal:
- `POST /api/campaigns/:id/start` em `backend/internal/api/handler/campaign.go`

O que acontece no start:
1. Busca a campanha no banco.
2. Reseta contadores de busca (`BeginCampaignSearchRun`).
3. Enfileira task `prospect:search` (Asynq, fila `critical`) com payload:
   - `niche`, `city`, `radius_km`, `campaign_id`, `min_google_reviews`, `max_companies`.
4. Atualiza status da campanha para `running` e responde HTTP com a campanha atualizada.

Execução da descoberta:
- Worker `mapsWorker.Handle` em `backend/internal/worker/maps_worker.go`.
- Chama Google Places API diretamente (não passa pelo playwright-svc):
  - Text Search: `https://maps.googleapis.com/maps/api/place/textsearch/json`
  - Details: `https://maps.googleapis.com/maps/api/place/details/json`

Filtros aplicados:
- Remove locais com reviews abaixo de `min_google_reviews`.
- Remove duplicados por `google_place_id`.
- Ignora tipos geográficos (ex.: `locality`, `neighborhood`).
- Para em `max_companies` por campanha.

## 2) Quando e como salva no banco (descoberta)
Ao aceitar um place, salva em `companies` com `CreateCompany`:
- `google_place_id`, `name`, `phone`, `website`, `address`, `city`, `state`, `lat`, `lng`, `category`, `google_rating`, `google_reviews_count`, `niche`.

Depois:
- Vincula em `campaign_companies` com `AddCompanyToCampaign`.
- Atualiza contadores da campanha com `IncrementCampaignSearchCounters`.
- Enfileira task `enrich:web`.

Tabelas envolvidas nesta fase:
- `companies`
- `campaign_companies`
- `campaigns` (contadores de busca)

## 3) Como liga Google Maps com Reclame Aqui
A ligação é feita no `webWorker` (`backend/internal/worker/web_worker.go`):
1. Lê a empresa recém-salva em `companies`.
2. Se tiver website, chama `ScrapeWebsite` no playwright-svc (`/scrape/website`).
3. Sempre tenta reputação no Reclame Aqui com `ScrapeReclameAqui(company.Name)` (`/scrape/reclame-aqui`).

Ou seja:
- **Fonte de identidade** vem do Google Maps (`company.Name`, `website`, etc.).
- **Consulta no Reclame Aqui** usa principalmente `company.Name`.
- O serviço playwright resolve perfil por slug e fallback de busca, extrai score, taxa de solução, tópicos e reclamações recentes.

## 4) Quando os dados de website/reputação são persistidos
Ainda no `webWorker`:
- Monta `raw_web_data` com:
  - dados de site,
  - dados do Reclame Aqui,
  - derivados (sinais, problemas, cobertura).
- Faz `UpsertIntelligence` em `company_intelligence` com:
  - `website_description`, `tech_stack`, `reputation_score`, `reputation_summary`, `pain_points`, `raw_web_data`.
- Depois enfileira `ai:analyze`.

Tabela principal desta etapa:
- `company_intelligence`

## 5) Depois disso: análise IA, stakeholders e mensagens
### `ai:analyze` (`aiWorker.Handle`)
- Lê `company` + `company_intelligence`.
- Recalcula análise determinística e faz novo `UpsertIntelligence`.
- Atualiza `companies.ai_score` + `enrichment_status='done'`.
- Atualiza stage da empresa para `analyzed`.
- Se score >= limiar da campanha (`min_ai_score_for_stakeholders`), enfileira `enrich:linkedin`; senão, vai direto para `ai:generate`.

### `enrich:linkedin` (`linkedInWorker.Handle`)
- Busca stakeholders por providers.
- Salva em `stakeholders`.
- Enfileira `ai:generate`.

### `ai:generate` (`aiWorker.HandleGenerate`)
- Gera mensagem WhatsApp + Email.
- Salva em `outreach_messages` via `CreateOutreachMessage` (status inicial `pending_review`).

## 6) Por onde as responses saem para o frontend
### Responses REST
Principais endpoints de leitura após pipeline:
- Campanha/progresso:
  - `GET /api/campaigns/:id`
  - `GET /api/campaigns/:id/progress`
- Empresas:
  - `GET /api/companies`
  - `GET /api/companies/:id`
  - `GET /api/companies/:id/intelligence`
  - `GET /api/companies/:id/stakeholders`
  - `GET /api/companies/:id/messages`
- Mensagens para revisão:
  - `GET /api/outreach/pending-review`

No frontend, a página de detalhe da campanha (`frontend/app/dashboard/campaigns/[id]/page.tsx`) faz polling de progresso a cada 4s via `apiFetch`.

### Responses em tempo real (WebSocket)
- Endpoint: `GET /ws` (autenticado).
- Hub em `backend/internal/api/hub.go`.
- Feed frontend em `frontend/components/realtime-feed.tsx`.
- Eventos esperados: `ai_analyzed`, `message_generated`, `message_approved`, `stage_changed`, `campaign_search_*`.

## 7) Ponto importante de arquitetura (impacta “responses em tempo real”)
No binário de worker (`backend/cmd/worker/main.go`), o broadcaster é `noop` (só loga debug):
- Comentário no código: `actual broadcasts happen only from API process`.

Na prática, se API e worker rodam como processos separados (padrão aqui), os eventos emitidos dentro dos workers (`campaign_search_progress`, `ai_analyzed`, `message_generated`) **não chegam automaticamente no WS do API Hub**.

Por isso, hoje o acompanhamento confiável de progresso está garantido pelo REST (`/api/campaigns/:id/progress`, polling), não pelo WS.

---

## Resumo direto
- Descoberta de empresas: Google Places API no `mapsWorker`.
- Vínculo com Reclame Aqui: no `webWorker`, usando `company.Name` salvo da descoberta.
- Persistência:
  - `companies` e `campaign_companies` na prospecção.
  - `company_intelligence` no enriquecimento web/reputação e análise IA.
  - `stakeholders` após enriquecimento LinkedIn.
  - `outreach_messages` após geração de mensagens.
- Responses após o pipeline:
  - REST (principal e consistente): endpoints `/api/campaigns/*`, `/api/companies/*`, `/api/outreach/*`.
  - WS existe, mas os eventos de worker dependem de ajuste de arquitetura para refletirem em tempo real no Hub da API.
