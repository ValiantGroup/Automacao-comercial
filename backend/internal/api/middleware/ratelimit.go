package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"time"
)

// RateLimit returns a rate limiting middleware.
// max: maximum requests per window period.
func RateLimit(max int) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			// Rate limit per user_id if authenticated, else per IP
			if uid, ok := c.Locals("user_id").(string); ok && uid != "" {
				return uid
			}
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "rate limit exceeded",
			})
		},
	})
}
