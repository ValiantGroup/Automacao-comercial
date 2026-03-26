package ai

import "fmt"

// ─── Analysis prompt ──────────────────────────────────────────────────────────

// AnalysisSystemPrompt is the system instruction for company analysis.
const AnalysisSystemPrompt = `Você é um analista de inteligência comercial B2B especializado em identificar oportunidades para empresas de tecnologia.
Analise os dados fornecidos e retorne SOMENTE um JSON válido com a estrutura exata solicitada.
Não inclua texto fora do JSON.`

// BuildAnalysisPrompt builds the user prompt for company analysis.
func BuildAnalysisPrompt(params AnalysisParams) string {
	return fmt.Sprintf(`Analise os dados abaixo sobre uma empresa e retorne SOMENTE um JSON válido com esta estrutura exata:
{
  "summary": "string (2-3 frases sobre o que a empresa faz)",
  "pain_points": ["string"],
  "fit_score": 0,
  "fit_justification": "string",
  "tech_stack": ["string"],
  "persona_priority": "CEO|CTO|HEAD_COMERCIAL|HEAD_ADM",
  "persona_justification": "string"
}

Contexto do nosso produto (Valiant Group): %s

Dados da empresa:
- Nome: %s
- Segmento: %s
- Website: %s
- LinkedIn: %s
- Stack tecnológico detectado: %s
- Vagas abertas: %s
- Reputação (Reclame Aqui): nota %s, %s
- Stakeholders encontrados: %s

Seja específico sobre as dores. fit_score deve ser de 0-100. persona_priority deve ser um dos valores literais listados.`,
		params.CampaignContext,
		params.CompanyName,
		params.Niche,
		strOrNA(params.WebsiteDescription),
		strOrNA(params.LinkedInAbout),
		strOrNA(params.TechStack),
		strOrNA(params.OpenJobs),
		strOrNA(params.ReputationScore),
		strOrNA(params.ReputationSummary),
		strOrNA(params.Stakeholders),
	)
}

// ─── Message generation prompt ────────────────────────────────────────────────

// MessageSystemPrompt is the system instruction for message generation.
const MessageSystemPrompt = `Você é um especialista em vendas B2B consultivas para o mercado brasileiro.
Crie mensagens de primeiro contato altamente personalizadas. Retorne SOMENTE um JSON válido.
Não inclua texto fora do JSON.`

// BuildMessagePrompt builds the user prompt for outreach message generation.
func BuildMessagePrompt(params MessageParams) string {
	return fmt.Sprintf(`Com base no relatório abaixo, escreva mensagens de primeiro contato para %s, %s da %s.

Regras OBRIGATÓRIAS:
- WhatsApp: máximo 300 caracteres, tom direto e humano, NÃO parecer robô, mencione algo específico da empresa
- Email assunto: máximo 60 caracteres, chame atenção sem ser clickbait
- Email corpo: máximo 150 palavras, tom profissional mas não formal demais
- Mencione UMA dor específica identificada, não genérica
- Posicione como parceiro estratégico, não como fornecedor genérico
- PROIBIDO: "espero que este e-mail te encontre bem", "gostaria de apresentar", frases clichê
- Escreva em português do Brasil

Retorne SOMENTE este JSON:
{
  "whatsapp": "string",
  "email_subject": "string",
  "email_body": "string"
}

Relatório da empresa: %s

Contexto da campanha: %s`,
		params.StakeholderName,
		params.StakeholderRole,
		params.CompanyName,
		params.IntelligenceJSON,
		params.CampaignContext,
	)
}

// ─── Role classification prompt ───────────────────────────────────────────────

// BuildRoleClassificationPrompt classifies a job title into a normalized role.
func BuildRoleClassificationPrompt(rawTitle string) string {
	return fmt.Sprintf(`Classifique o cargo abaixo em uma das categorias exatas: CEO, CTO, COO, CFO, HEAD_COMERCIAL, HEAD_ADM, HEAD_TECH, OTHER

Cargo: "%s"

Retorne SOMENTE um JSON:
{"role": "CATEGORIA"}`, rawTitle)
}

// ─── Params ───────────────────────────────────────────────────────────────────

type AnalysisParams struct {
	CampaignContext    string
	CompanyName        string
	Niche              string
	WebsiteDescription *string
	LinkedInAbout      *string
	TechStack          *string
	OpenJobs           *string
	ReputationScore    *string
	ReputationSummary  *string
	Stakeholders       *string
}

type MessageParams struct {
	StakeholderName  string
	StakeholderRole  string
	CompanyName      string
	IntelligenceJSON string
	CampaignContext  string
}

func strOrNA(s *string) string {
	if s == nil || *s == "" {
		return "N/A"
	}
	return *s
}
