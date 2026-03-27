package api

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gofiber/websocket/v2"
)

// Hub manages all active WebSocket connections and broadcasts events to them.
type Hub struct {
	clients   map[*websocket.Conn]bool
	mu        sync.RWMutex
	broadcast chan []byte
}

type WSEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan []byte, 256),
	}
}

// Run is the main hub loop — must be called in a goroutine.
func (h *Hub) Run() {
	for msg := range h.broadcast {
		h.mu.RLock()
		conns := make([]*websocket.Conn, 0, len(h.clients))
		for conn := range h.clients {
			conns = append(conns, conn)
		}
		h.mu.RUnlock()

		for _, conn := range conns {
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				slog.Debug("WS write error, removing client", "error", err)
				h.mu.Lock()
				delete(h.clients, conn)
				h.mu.Unlock()
				conn.Close()
			}
		}
	}
}

// Broadcast sends an event to all connected WebSocket clients.
func (h *Hub) Broadcast(eventType string, payload interface{}) {
	event := WSEvent{Type: eventType, Payload: payload}
	b, err := json.Marshal(event)
	if err != nil {
		slog.Error("WS marshal error", "error", err)
		return
	}
	select {
	case h.broadcast <- b:
	default:
		slog.Warn("WS broadcast channel full, dropping event", "type", eventType)
	}
}

// HandleWS is the Fiber WebSocket handler for new connections.
func (h *Hub) HandleWS(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	slog.Info("WS client connected", "addr", c.RemoteAddr())

	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		c.Close()
		slog.Info("WS client disconnected", "addr", c.RemoteAddr())
	}()

	stopPing := make(chan struct{})
	defer close(stopPing)

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := c.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second)); err != nil {
					return
				}
			case <-stopPing:
				return
			}
		}
	}()

	// Keep alive — read messages (client ping or close)
	for {
		_, _, err := c.ReadMessage()
		if err != nil {
			break
		}
	}
}
