import { Controller, Post, Body, Get, Req, Res, HttpStatus } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { Request, Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('username') username?: string,
  ) {
    const user = await this.authService.register(email, password, username);
    return { message: 'User registered successfully', userId: user.id };
  }

  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Res() res: Response,
  ) {
    const user = await this.authService.validateUser(email, password);
    
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Invalid credentials' });
    }
    
    const token = await this.authService.login(user);
    return res.status(HttpStatus.OK).json({
      message: 'Login successful',
      ...token,
    });
  }

  @Get('profile')
  async getProfile(@Req() req: Request) {
    // Verify JWT token and return user info
    return { message: 'Profile retrieved', user: (req as any).user };
  }
}