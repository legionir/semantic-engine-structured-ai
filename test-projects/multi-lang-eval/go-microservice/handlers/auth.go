package handlers

import (
	"encoding/json"
	"net/http"
	"go-microservice/store"
)

type AuthHandler struct {
	store store.UserStore
}

func NewAuthHandler(s store.UserStore) *AuthHandler {
	return &AuthHandler{store: s}
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AuthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	user, err := h.store.GetUserByUsername(req.Username)
	if err != nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(user)
}

func (h *AuthHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusCreated)
}
