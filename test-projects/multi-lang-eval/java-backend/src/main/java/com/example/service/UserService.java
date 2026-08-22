package com.example.service;

public interface UserService {
    String findUserById(String id);
    void registerUser(String name, String email);
}

class UserServiceImpl implements UserService {
    @Override
    public String findUserById(String id) {
        return "User_" + id;
    }

    @Override
    public void registerUser(String name, String email) {
        System.out.println("Registering: " + name);
    }
}
