package worker

import "strings"

// classifyNormalizedRole tries deterministic role normalization before AI fallback.
func classifyNormalizedRole(rawTitle, email string) string {
	text := strings.ToLower(strings.TrimSpace(rawTitle))
	if text == "" {
		text = emailLocalPart(email)
	}
	if text == "" {
		return "OTHER"
	}

	if hasAny(text, "ceo", "chief executive", "presidente", "founder", "co-founder", "cofounder", "sócio", "socio") {
		return "CEO"
	}
	if hasAny(text, "cto", "chief technology", "diretor de tecnologia", "head de tecnologia", "head de ti", "gerente de tecnologia", "engenharia", "technology") {
		return "CTO"
	}
	if hasAny(text, "coo", "chief operating", "operações", "operacoes", "diretor operacional", "operations") {
		return "COO"
	}
	if hasAny(text, "cfo", "chief financial", "financeiro", "finanças", "financas", "controller", "tesouraria") {
		return "CFO"
	}
	if hasAny(text, "comercial", "vendas", "sales", "business development", "receita", "head comercial", "diretor comercial") {
		return "HEAD_COMERCIAL"
	}
	if hasAny(text, "administrativo", "administração", "administracao", "office manager", "facilities", "rh", "people", "human resources") {
		return "HEAD_ADM"
	}
	if hasAny(text, "ti", "it", "infra", "devops", "engenheiro", "desenvolvedor", "software", "tech", "tecnologia") {
		return "HEAD_TECH"
	}

	return "OTHER"
}

func hasAny(text string, keywords ...string) bool {
	for _, k := range keywords {
		if strings.Contains(text, k) {
			return true
		}
	}
	return false
}

func emailLocalPart(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return ""
	}
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.ReplaceAll(parts[0], ".", " ")
}
