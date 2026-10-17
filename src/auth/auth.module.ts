import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenNotRevokedGuard } from './guards/token-not-revoked.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    PassportModule,
    PrismaModule,
    JwtModule.register({
      // Dev fallback to keep local testing functional.
      // For production, always set `JWT_SECRET` in your environment.
      secret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '365d') as any },
    }),
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard, TokenNotRevokedGuard],
  exports: [AuthService],
})
export class AuthModule {}

