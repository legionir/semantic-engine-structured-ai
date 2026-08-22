package com.example.controller;

import com.example.service.UserService;

public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    public String getUser(String id) {
        return this.userService.findUserById(id);
    }
}
