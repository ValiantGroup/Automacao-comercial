package ai

import (
	"encoding/json"
	"fmt"
)

// ─── Analysis response ────────────────────────────────────────────────────────

type AnalysisResult struct {
	Summary              string   `json:"summary"`
	PainPoints           []string `json:"pain_points"`
	FitScore             int      `json:"fit_score"`
	FitJustification     string   `json:"fit_justification"`
	TechStack            []string `json:"tech_stack"`
	PersonaPriority      string   `json:"persona_priority"`
	PersonaJustification string   `json:"persona_justification"`
}

// ParseAnalysis parses the raw JSON string returned by the AI into AnalysisResult.
func ParseAnalysis(raw string) (AnalysisResult, error) {
	var result AnalysisResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return result, fmt.Errorf("parse analysis: %w — raw: %s", err, raw)
	}
	if result.FitScore < 0 || result.FitScore > 100 {
		result.FitScore = clamp(result.FitScore, 0, 100)
	}
	return result, nil
}

// ─── Message response ─────────────────────────────────────────────────────────

type MessageResult struct {
	WhatsApp     string `json:"whatsapp"`
	EmailSubject string `json:"email_subject"`
	EmailBody    string `json:"email_body"`
}

// ParseMessages parses the raw JSON string returned by the AI into MessageResult.
func ParseMessages(raw string) (MessageResult, error) {
	var result MessageResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return result, fmt.Errorf("parse messages: %w — raw: %s", err, raw)
	}
	// Enforce WhatsApp 300-char limit
	if len([]rune(result.WhatsApp)) > 300 {
		runes := []rune(result.WhatsApp)
		result.WhatsApp = string(runes[:297]) + "..."
	}
	return result, nil
}

// ─── Role response ────────────────────────────────────────────────────────────

type RoleResult struct {
	Role string `json:"role"`
}

// ParseRole parses the normalized role from the AI response.
func ParseRole(raw string) (string, error) {
	var result RoleResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return "OTHER", nil // fallback gracefully
	}
	valid := map[string]bool{
		"CEO": true, "CTO": true, "COO": true, "CFO": true,
		"HEAD_COMERCIAL": true, "HEAD_ADM": true, "HEAD_TECH": true, "OTHER": true,
	}
	if !valid[result.Role] {
		return "OTHER", nil
	}
	return result.Role, nil
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
