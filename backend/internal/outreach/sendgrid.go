package outreach

import (
	"context"
	"fmt"

	sendgrid "github.com/sendgrid/sendgrid-go"
	"github.com/sendgrid/sendgrid-go/helpers/mail"
)

// SendGridClient sends transactional emails via SendGrid.
type SendGridClient struct {
	apiKey    string
	fromEmail string
	fromName  string
}

func NewSendGridClient(apiKey, fromEmail string) *SendGridClient {
	return &SendGridClient{
		apiKey:    apiKey,
		fromEmail: fromEmail,
		fromName:  "Valiant Group",
	}
}

// SendEmail sends an email and returns the SendGrid message ID (from X-Message-Id header).
func (s *SendGridClient) SendEmail(ctx context.Context, toEmail, toName, subject, body string) (string, error) {
	from := mail.NewEmail(s.fromName, s.fromEmail)
	to := mail.NewEmail(toName, toEmail)

	message := mail.NewSingleEmail(from, subject, to, "", body)

	// Enable open and click tracking
	message.SetTrackingSettings(&mail.TrackingSettings{
		ClickTracking: &mail.ClickTrackingSetting{
			Enable: boolPtr(true),
		},
		OpenTracking: &mail.OpenTrackingSetting{
			Enable: boolPtr(true),
		},
	})

	client := sendgrid.NewSendClient(s.apiKey)
	response, err := client.SendWithContext(ctx, message)
	if err != nil {
		return "", fmt.Errorf("sendgrid send: %w", err)
	}

	if response.StatusCode >= 400 {
		return "", fmt.Errorf("sendgrid error %d: %s", response.StatusCode, response.Body)
	}

	// Extract message ID from response headers
	msgID := response.Headers["X-Message-Id"]
	if len(msgID) > 0 {
		return msgID[0], nil
	}
	return "", nil
}

func boolPtr(b bool) *bool {
	return &b
}
