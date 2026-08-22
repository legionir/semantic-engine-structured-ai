package main

import (
	"fmt"
	"net/http"
	"go-microservice/handlers"
	"go-microservice/store"
)

type ServerConfig struct {
	Port int
	Host string
}

func (c *ServerConfig) Address() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

func main() {
	db := store.NewMemoryStore()
	authHandler := handlers.NewAuthHandler(db)

	http.HandleFunc("/login", authHandler.HandleLogin)
	http.HandleFunc("/register", authHandler.HandleRegister)

	cfg := &ServerConfig{Port: 8080, Host: "0.0.0.0"}
	fmt.Printf("Server listening on %s\n", cfg.Address())
}
