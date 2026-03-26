package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/sony/gobreaker"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/outreach"
)

type outreachWorker struct {
	cfg             *config.Config
	queries         *db.Queries
	evolutionClient *outreach.EvolutionClient
	sendgridClient  *outreach.SendGridClient
	broadcaster     func(eventType string, payload interface{})
	waCB            *gobreaker.CircuitBreaker
	emailCB         *gobreaker.CircuitBreaker
}

func newOutreachWorker(
	cfg *config.Config,
	queries *db.Queries,
	evolutionClient *outreach.EvolutionClient,
	sendgridClient *outreach.SendGridClient,
	broadcaster func(string, interface{}),
) *outreachWorker {
	cbSettings := gobreaker.Settings{
		Name:        "evolution",
		MaxRequests: 1,
		Interval:    60,
		Timeout:     30,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	}

	emailCBSettings := cbSettings
	emailCBSettings.Name = "sendgrid"

	return &outreachWorker{
		cfg:             cfg,
		queries:         queries,
		evolutionClient: evolutionClient,
		sendgridClient:  sendgridClient,
		broadcaster:     broadcaster,
		waCB:            gobreaker.NewCircuitBreaker(cbSettings),
		emailCB:         gobreaker.NewCircuitBreaker(emailCBSettings),
	}
}

type outreachPayload struct {
	MessageID string `json:"message_id"`
}

func (w *outreachWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p outreachPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal outreach payload: %w", err)
	}

	msgID, err := uuid.Parse(p.MessageID)
	if err != nil {
		return fmt.Errorf("parse message_id: %w", err)
	}

	msg, err := w.queries.GetOutreachMessage(ctx, msgID)
	if err != nil {
		return fmt.Errorf("get outreach message: %w", err)
	}

	if msg.Status != "approved" {
		slog.Warn("Message not approved, skipping send", "message_id", msgID, "status", msg.Status)
		return nil
	}

	var sendgridID, evolutionID *string

	switch msg.Channel {
	case "whatsapp":
		if err := w.sendWhatsApp(ctx, msg, &evolutionID); err != nil {
			w.queries.UpdateMessageStatus(ctx, msgID, "failed")
			return fmt.Errorf("send whatsapp: %w", err)
		}
	case "email":
		if err := w.sendEmail(ctx, msg, &sendgridID); err != nil {
			w.queries.UpdateMessageStatus(ctx, msgID, "failed")
			return fmt.Errorf("send email: %w", err)
		}
	default:
		return fmt.Errorf("unknown channel: %s", msg.Channel)
	}

	// Mark as sent
	if _, err := w.queries.MarkMessageSent(ctx, msgID, sendgridID, evolutionID); err != nil {
		slog.Error("Mark message sent failed", "message_id", msgID, "error", err)
	}

	// Advance company stage to 'contacted'
	w.queries.UpdateCompanyStage(ctx, msg.CompanyID, "contacted")

	// Emit WebSocket event
	w.broadcaster("message_sent", map[string]interface{}{
		"message_id": msgID,
		"company_id": msg.CompanyID,
		"channel":    msg.Channel,
	})

	slog.Info("Message sent", "message_id", msgID, "channel", msg.Channel, "company_id", msg.CompanyID)
	return nil
}

func (w *outreachWorker) sendWhatsApp(ctx context.Context, msg db.OutreachMessage, idOut **string) error {
	// Get phone from stakeholder or company
	phone := ""
	if msg.StakeholderID != nil {
		s, err := w.queries.GetStakeholder(ctx, *msg.StakeholderID)
		if err == nil && s.Phone != nil {
			phone = *s.Phone
		}
	}
	if phone == "" {
		company, err := w.queries.GetCompany(ctx, msg.CompanyID)
		if err == nil && company.Phone != nil {
			phone = *company.Phone
		}
	}
	if phone == "" {
		return fmt.Errorf("no phone number available for WhatsApp send")
	}

	// Normalize phone (remove non-digits)
	cleaned := ""
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			cleaned += string(r)
		}
	}

	result, err := w.waCB.Execute(func() (interface{}, error) {
		return w.evolutionClient.SendText(ctx, cleaned, msg.Content)
	})
	if err != nil {
		return err
	}

	id := result.(string)
	*idOut = &id
	return nil
}

func (w *outreachWorker) sendEmail(ctx context.Context, msg db.OutreachMessage, idOut **string) error {
	toEmail := ""
	toName := ""

	if msg.StakeholderID != nil {
		s, err := w.queries.GetStakeholder(ctx, *msg.StakeholderID)
		if err == nil {
			if s.Email != nil {
				toEmail = *s.Email
			}
			toName = s.Name
		}
	}
	if toEmail == "" {
		return fmt.Errorf("no email address available for email send")
	}

	subject := "Contato Valiant Group"
	if msg.Subject != nil {
		subject = *msg.Subject
	}

	result, err := w.emailCB.Execute(func() (interface{}, error) {
		return w.sendgridClient.SendEmail(ctx, toEmail, toName, subject, msg.Content)
	})
	if err != nil {
		return err
	}

	id := result.(string)
	*idOut = &id
	return nil
}
