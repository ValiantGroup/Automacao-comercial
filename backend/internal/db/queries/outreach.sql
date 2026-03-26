-- name: GetOutreachMessage :one
SELECT * FROM outreach_messages WHERE id = $1;

-- name: ListPendingReview :many
SELECT om.*, c.name AS company_name, s.name AS stakeholder_name
FROM outreach_messages om
JOIN companies c ON c.id = om.company_id
LEFT JOIN stakeholders s ON s.id = om.stakeholder_id
WHERE om.status = 'pending_review'
ORDER BY om.created_at DESC;

-- name: ListMessagesByCompany :many
SELECT * FROM outreach_messages WHERE company_id = $1 ORDER BY created_at DESC;

-- name: CreateOutreachMessage :one
INSERT INTO outreach_messages (company_id, stakeholder_id, campaign_id, channel, content, subject)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateMessageStatus :one
UPDATE outreach_messages SET status = $2 WHERE id = $1 RETURNING *;

-- name: MarkMessageSent :one
UPDATE outreach_messages SET
  status = 'sent',
  sent_at = NOW(),
  sendgrid_message_id = $2,
  evolution_message_id = $3
WHERE id = $1
RETURNING *;

-- name: MarkMessageOpened :exec
UPDATE outreach_messages SET status = 'opened', opened_at = NOW() WHERE sendgrid_message_id = $1;

-- name: MarkMessageReplied :exec
UPDATE outreach_messages SET status = 'replied', replied_at = NOW() WHERE id = $1;

-- name: CountPendingReview :one
SELECT COUNT(*) FROM outreach_messages WHERE status = 'pending_review';

-- name: CountSentToday :one
SELECT COUNT(*) FROM outreach_messages
WHERE status = 'sent' AND sent_at >= NOW()::date;

-- name: OutreachStats :one
SELECT
  COUNT(*) FILTER (WHERE status = 'sent') AS total_sent,
  COUNT(*) FILTER (WHERE status = 'opened') AS total_opened,
  COUNT(*) FILTER (WHERE status = 'replied') AS total_replied,
  COUNT(*) FILTER (WHERE status = 'pending_review') AS pending_review
FROM outreach_messages;
