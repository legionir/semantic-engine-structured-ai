package store

import (
	"errors"
	"sync"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

type UserStore interface {
	GetUserByUsername(username string) (*User, error)
	SaveUser(user *User) error
}

type MemoryStore struct {
	mu    sync.RWMutex
	users map[string]*User
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		users: make(map[string]*User),
	}
}

func (s *MemoryStore) GetUserByUsername(username string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	user, ok := s.users[username]
	if !ok {
		return nil, errors.New("user not found")
	}
	return user, nil
}

func (s *MemoryStore) SaveUser(user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.users[user.Username] = user
	return nil
}
