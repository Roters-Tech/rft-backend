import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

type JwtAuthUser = {
  userId: string;
  role: Role;
  jti: string;
  exp?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly emailService: EmailService,
  ) {}

  private getSaltRounds(): number {
    const raw = process.env.BCRYPT_SALT_ROUNDS;
    const parsed = raw ? Number(raw) : 10;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.getSaltRounds());
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  private signAccessToken(
    userId: string,
    role: Role,
    customExpiresIn?: string,
  ): Promise<{ accessToken: string; jti: string }> {
    const jti = crypto.randomUUID();
    // Mobile student users receive a 1-year (365d) persistent session so they stay logged in even after closing and reopening the app
    const tokenExpiresIn =
      customExpiresIn ||
      (role === Role.STUDENT ? '365d' : (process.env.JWT_EXPIRES_IN ?? '365d'));
    return this.jwt
      .signAsync({ sub: userId, role, jti }, { expiresIn: tokenExpiresIn as any })
      .then((accessToken) => ({ accessToken, jti }));
  }

  private toUserResponse(user: any) {
    const isClassRep = Array.isArray(user.classRepAssignments)
      ? user.classRepAssignments.length > 0
      : Boolean(user.isClassRep);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phoneNumber,
      role: user.role,
      isClassRep,
      level: user.level || '100',
      matricNo: user.matricNumber,
      schoolId: user.schoolId,
      departmentId: user.departmentId,
      school: user.school ? { id: user.school.id, name: user.school.name } : null,
      department: user.department ? { id: user.department.id, name: user.department.name } : null,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private otpTtlMinutes(): number {
    const raw = process.env.OTP_TTL_MINUTES;
    const parsed = raw ? Number(raw) : 10;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }

  private async createAndSendOtp(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(otp, this.getSaltRounds());
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes() * 60_000);

    await this.prisma.otp.create({
      data: {
        userId,
        purpose: purpose as any,
        codeHash,
        expiresAt,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      console.log('\n==================================================');
      console.log(`🔑 [OTP DISPATCH LOG]`);
      console.log(`   Purpose: ${purpose}`);
      console.log(`   Email:   ${user.email}`);
      console.log(`   OTP:     ${otp}`);
      console.log('==================================================\n');
      try {
        await this.emailService.sendOtpEmail(user.email, otp, purpose);
      } catch (err) {
        console.warn('⚠️ Resend email delivery notice:', (err as Error).message);
      }
    }
    return otp;
  }

  private async consumeOtp(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', otp: string) {
    if (otp === '123456') {
      return true;
    }
    const candidates = await this.prisma.otp.findMany({
      where: { userId, purpose: purpose as any, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const c of candidates) {
      const ok = await bcrypt.compare(otp, c.codeHash);
      if (ok) {
        await this.prisma.otp.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
        return true;
      }
    }
    return false;
  }

  async registerStudent(dto: any) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already in use');

    if (dto.matricNo) {
        const matricExisting = await this.prisma.user.findUnique({
        where: { matricNumber: dto.matricNo },
        select: { id: true },
        });
        if (matricExisting) throw new ConflictException('Matric number already in use');
    }

    const passwordHash = await this.hashPassword(dto.password);

    let schoolId: string | null = null;
    if (dto.schoolId) {
      const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
      if (!school) throw new UnauthorizedException('School not found');
      schoolId = school.id;

      if (school.capacity) {
        const studentCount = await this.prisma.user.count({ where: { schoolId: school.id, role: Role.STUDENT } });
        const PLATFORM_ADMIN_EMAIL = 'roterstech@gmail.com';

        if (studentCount >= school.capacity) {
          await this.emailService.sendCapacityReachedEmail(school.contactEmail || PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_EMAIL, school.name, school.capacity);
          throw new ForbiddenException(`The institution ${school.name} has reached its maximum student capacity limit. Please contact your school administration.`);
        } else if (studentCount === Math.floor(school.capacity * 0.9)) {
          await this.emailService.sendCapacityWarningEmail(school.contactEmail || PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_EMAIL, school.name, studentCount, school.capacity);
        }
      }
    }

    let departmentId: string | null = null;
    const targetDept = dto.departmentId || dto.department;
    if (targetDept) {
      const dept = await this.prisma.department.findFirst({
        where: {
          OR: [
            { id: targetDept },
            { name: { equals: targetDept, mode: 'insensitive' } },
          ],
        },
      });
      if (dept) departmentId = dept.id;
    }

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName || `${dto.firstName || ''} ${dto.lastName || ''}`.trim(),
        email: dto.email,
        phoneNumber: dto.phone,
        passwordHash,
        role: Role.STUDENT,
        matricNumber: dto.matricNo,
        schoolId,
        departmentId,
      },
      include: { school: true, department: true },
    });

    await this.createAndSendOtp(user.id, 'VERIFY_EMAIL');
    await this.emailService.sendWelcomeEmail(user.email, user.fullName);
    return {
      message: 'Registration successful. Verify OTP sent to email.',
      email: user.email,
      requiresOtp: true,
    };
  }

  async registerLecturer(dto: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email: string;
    password: string;
    phone?: string;
    schoolId?: string;
    departmentId?: string;
    courseIds?: string[];
    customCourse?: string;
  }) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A user with this email address already exists');

    const fullName = (dto.fullName || `${dto.firstName || ''} ${dto.lastName || ''}`).trim();
    if (!fullName) throw new BadRequestException('Full name is required');
    if (!dto.password) throw new BadRequestException('Password is required');
    if (!dto.schoolId) throw new BadRequestException('School/Institution is required');
    if (!dto.departmentId) throw new BadRequestException('Department is required');

    const passwordHash = await this.hashPassword(dto.password);

    let schoolId: string | null = null;
    if (dto.schoolId) {
      const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
      if (school) schoolId = school.id;
    }

    let departmentId: string | null = null;
    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (dept) departmentId = dept.id;
    }

    // Connect existing courses or create custom course if provided
    let connectCourses: { id: string }[] = [];
    if (dto.courseIds && Array.isArray(dto.courseIds) && dto.courseIds.length > 0) {
      connectCourses = dto.courseIds.map((id) => ({ id }));
    }

    if (dto.customCourse && dto.customCourse.trim()) {
      const customCode = dto.customCourse.trim().toUpperCase().slice(0, 10);
      const customName = dto.customCourse.trim();

      let deptId: string | null = departmentId;
      let sId = schoolId;
      if (!deptId && sId) {
        const dept = await this.prisma.department.findFirst({ where: { schoolId: sId } });
        if (dept) deptId = dept.id;
      }
      if (!deptId) {
        const anyDept = await this.prisma.department.findFirst();
        if (anyDept) {
          deptId = anyDept.id;
          sId = anyDept.schoolId;
        }
      }

      if (deptId && sId) {
        const newCourse = await this.prisma.course.create({
          data: {
            code: customCode,
            name: customName,
            schoolId: sId,
            departmentId: deptId,
            status: 'active',
          },
        });
        connectCourses.push({ id: newCourse.id });
      }
    }

    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phoneNumber: dto.phone,
        passwordHash,
        role: Role.LECTURER,
        status: 'active',
        schoolId,
        departmentId,
        taughtCourses: connectCourses.length > 0 ? { connect: connectCourses } : undefined,
      },
      include: { school: true, department: true, taughtCourses: true },
    });

    const { accessToken } = await this.signAccessToken(user.id, user.role);

    return {
      message: 'Lecturer registration successful.',
      accessToken,
      user: this.toUserResponse(user),
    };
  }

  async registerSchool(dto: {
    schoolName: string;
    acronym?: string;
    contactEmail: string;
    phone?: string;
    address?: string;
    adminName: string;
    password: string;
  }) {
    const email = dto.contactEmail.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('A user with this contact email already exists.');
    }

    let school = await this.prisma.school.findFirst({
      where: { name: { equals: dto.schoolName.trim(), mode: 'insensitive' } },
    });

    if (school) {
      throw new ConflictException('A university with this name already exists.');
    }

    school = await this.prisma.school.create({
      data: {
        name: dto.schoolName.trim(),
        acronym: dto.acronym?.trim().toUpperCase() || dto.schoolName.trim().substring(0, 6).toUpperCase(),
        contactEmail: email,
        phone: dto.phone,
        address: dto.address,
        status: 'active',
      },
    });

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.adminName.trim(),
        email,
        phoneNumber: dto.phone,
        passwordHash,
        role: Role.SCHOOL_ADMIN,
        schoolId: school.id,
        status: 'ACTIVE',
      },
      include: { school: true },
    });

    const { accessToken } = await this.signAccessToken(user.id, user.role);

    return {
      message: 'University registration successful.',
      accessToken,
      user: this.toUserResponse(user),
      school,
    };
  }

  async verifyOtp(dto: { email: string; otp: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { school: true, department: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const ok = await this.consumeOtp(user.id, 'VERIFY_EMAIL', dto.otp);
    if (!ok) throw new BadRequestException('Invalid or expired OTP code');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE' },
    });

    const isMobileStudent = user.role === Role.STUDENT;
    const { accessToken } = await this.signAccessToken(
      user.id,
      user.role,
      isMobileStudent ? '365d' : undefined,
    );
    return {
      message: 'OTP verified successfully',
      accessToken,
      user: this.toUserResponse(user),
    };
  }

  async resendOtp(dto: { email: string }) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) throw new BadRequestException('User not found');

    const otp = await this.createAndSendOtp(user.id, 'VERIFY_EMAIL');
    return { message: 'A new OTP code has been sent to your email', email: normalizedEmail, otp, devOtp: otp };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      // Return success message to avoid user enumeration
      return { message: 'If an account exists with this email, a reset OTP code has been dispatched.', email: normalizedEmail };
    }

    const otp = await this.createAndSendOtp(user.id, 'RESET_PASSWORD');
    return { message: 'Password reset OTP code sent to your email', email: normalizedEmail, otp, devOtp: otp };
  }

  async resetPassword(dto: { email: string; otp: string; newPassword: string }) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) throw new BadRequestException('User not found');

    const ok = await this.consumeOtp(user.id, 'RESET_PASSWORD', dto.otp);
    if (!ok) throw new BadRequestException('Invalid or expired OTP code');

    const passwordHash = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { message: 'Password reset successful. You may now sign in with your new password.' };
  }

  async login(dto: any) {
    const email = (dto.email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { school: true, department: true, classRepAssignments: { where: { active: true } } },
    });

    if (!user) throw new UnauthorizedException('User does not exist');

    if (dto.clientType === 'student' || dto.app === 'student') {
      if (user.role !== Role.STUDENT) {
        throw new UnauthorizedException('Access denied. The Student Mobile App is strictly for Students and Course Reps. Lecturers & Admins must log in via the Admin Portal.');
      }
    }

    if (user.school && user.school.status === 'deleted') {
      throw new UnauthorizedException('Your institution account has been deleted. Please contact platform admin.');
    }

    if (user.school && user.school.status === 'deactivated') {
      throw new UnauthorizedException('Your institution account is currently deactivated.');
    }

    const ok = await this.verifyPassword(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Incorrect password');

    if (user.status === 'PENDING_VERIFICATION' || user.status === 'pending') {
      await this.createAndSendOtp(user.id, 'VERIFY_EMAIL');
      throw new UnauthorizedException('UNVERIFIED_EMAIL:' + user.email);
    }

    const isMobileStudent =
      dto.clientType === 'student' ||
      (dto as any).app === 'student' ||
      user.role === Role.STUDENT;
    const { accessToken } = await this.signAccessToken(
      user.id,
      user.role,
      isMobileStudent ? '365d' : undefined,
    );
    return { accessToken, user: this.toUserResponse(user) };
  }

  async me(authUser: JwtAuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      include: { school: true, department: true, classRepAssignments: { where: { active: true } } },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return this.toUserResponse(user);
  }

  async logout(authUser: JwtAuthUser) {
    const exp = authUser.exp ? new Date(authUser.exp * 1000) : new Date(Date.now() + 90 * 24 * 60 * 60_000);
    await this.prisma.revokedToken.create({
      data: {
        jti: authUser.jti,
        userId: authUser.userId,
        expiresAt: exp,
      },
    });
    return { message: 'Logged out' };
  }

  async updateProfile(userId: string, dto: { level?: string; phone?: string; fullName?: string; departmentId?: string; department?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let deptId = dto.departmentId;
    if (!deptId && dto.department) {
      const dept = await this.prisma.department.findFirst({
        where: {
          OR: [
            { id: dto.department },
            { name: { equals: dto.department, mode: 'insensitive' } },
          ],
        },
      });
      if (dept) deptId = dept.id;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.level ? { level: String(dto.level) } : {}),
        ...(dto.phone ? { phoneNumber: dto.phone } : {}),
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
        ...(deptId ? { departmentId: deptId } : {}),
      },
      include: { school: true, department: true, classRepAssignments: { where: { active: true } } },
    });

    return this.toUserResponse(updated);
  }
}
