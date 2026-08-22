<?php
namespace App\Controller;

use App\Model\User;

class AuthController {
    public function login(string $username, string $password): array {
        if (empty($username)) {
            return ['status' => 'error', 'message' => 'Username required'];
        }
        $user = new User(1, $username);
        return ['status' => 'ok', 'user' => $user->toArray()];
    }

    public function logout(): void {
        // destroy session
    }
}
