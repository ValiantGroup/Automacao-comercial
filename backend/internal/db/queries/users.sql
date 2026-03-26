-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: CreateUser :one
INSERT INTO users (name, email, password_hash, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListUsers :many
SELECT id, name, email, role, created_at FROM users ORDER BY created_at;
