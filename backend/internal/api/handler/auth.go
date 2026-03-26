package handler

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/valiant-group/prospector/internal/api/middleware"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type AuthHandler struct {
	queries   *db.Queries
	jwtSecret string
}

func NewAuthHandler(queries *db.Queries, jwtSecret string) *AuthHandler {
	return &AuthHandler{queries: queries, jwtSecret: jwtSecret}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
		Role  string `json:"role"`
	} `json:"user"`
}

func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var req loginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email and password required"})
	}

	user, err := h.queries.GetUserByEmail(c.Context(), req.Email)
	if err != nil {
		slog.Debug("User not found", "email", req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	accessToken, err := h.generateToken(user.ID.String(), user.Role, 15*time.Minute)
	if err != nil {
		slog.Error("Generate access token", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token generation failed"})
	}

	refreshToken, err := h.generateToken(user.ID.String(), user.Role, 7*24*time.Hour)
	if err != nil {
		slog.Error("Generate refresh token", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token generation failed"})
	}

	resp := loginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}
	resp.User.ID = user.ID.String()
	resp.User.Name = user.Name
	resp.User.Email = user.Email
	resp.User.Role = user.Role

	return c.JSON(resp)
}

func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
	}

	claims := &middleware.Claims{}
	token, err := jwt.ParseWithClaims(body.RefreshToken, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(h.jwtSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid refresh token"})
	}

	accessToken, err := h.generateToken(claims.UserID, claims.Role, 15*time.Minute)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token generation failed"})
	}

	return c.JSON(fiber.Map{"access_token": accessToken})
}

func (h *AuthHandler) generateToken(userID, role string, duration time.Duration) (string, error) {
	claims := middleware.Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.jwtSecret))
}
