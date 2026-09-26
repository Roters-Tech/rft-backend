import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly supabaseStorage: SupabaseStorageService,
  ) {}

  async createUser(dto: { fullName: string; email: string; schoolId?: string; departmentId?: string; phoneNumber?: string; courseIds?: string[]; role?: Role }) {
    const { fullName, email, schoolId, departmentId, phoneNumber, courseIds, role } = dto;

    if (!fullName || !email) {
      throw new BadRequestException('Full name and email are required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email address already exists');
    }

    // Generate temporary password
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const rolePrefix = dto.role === Role.SCHOOL_ADMIN ? 'Adm' : dto.role === Role.SUPER_ADMIN ? 'Sup' : 'Lec';
    const tempPassword = `${rolePrefix}#${randomSuffix}!`;

    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Get school name if schoolId is provided
    let schoolName: string | undefined;
    if (schoolId) {
      const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
      if (school) schoolName = school.name;
    }

    // Connect courses if provided
    let taughtCoursesData: any = undefined;
    if (courseIds && Array.isArray(courseIds) && courseIds.length > 0) {
      taughtCoursesData = {
        connect: courseIds.map((cId) => ({ id: cId })),
      };
    }

    // Create user in DB
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        fullName: fullName.trim(),
        passwordHash: hashedPassword,
        role: role || Role.LECTURER,
        status: 'ACTIVE',
        phoneNumber: phoneNumber?.trim(),
        schoolId: schoolId || null,
        departmentId: departmentId || null,
        taughtCourses: taughtCoursesData,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        status: true,
        school: { select: { id: true, name: true, acronym: true } },
        department: { select: { id: true, name: true } },
        taughtCourses: { select: { id: true, code: true, name: true } },
        createdAt: true,
      },
    });

    // Send email with credentials via Resend
    await this.emailService.sendRoleCredentialsEmail(
      user.email,
      user.fullName,
      tempPassword,
      user.role,
      schoolName,
    );

    return {
      message: 'Account created successfully. Credentials sent via email.',
      tempPassword,
      user,
    };
  }

  async updateLecturerCourses(id: string, courseIds: string[], customCourse?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const connectCourses: { id: string }[] = (courseIds || []).map((cId) => ({ id: cId }));

    if (customCourse && customCourse.trim()) {
      const customCode = customCourse.trim().toUpperCase().slice(0, 10);
      const customName = customCourse.trim();
      let deptId: string | null = null;
      let sId = user.schoolId;

      if (sId) {
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

    return this.prisma.user.update({
      where: { id },
      data: {
        taughtCourses: {
          set: connectCourses,
        },
      },
      select: {
        id: true,
        fullName: true,
        taughtCourses: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async updateUser(id: string, dto: { fullName?: string; email?: string; status?: string; schoolId?: string; courseIds?: string[]; bio?: string; title?: string; phoneNumber?: string; certifications?: any; achievements?: any }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const data: any = {};
    if (dto.fullName) data.fullName = dto.fullName.trim();
    if (dto.email) data.email = dto.email.trim().toLowerCase();
    if (dto.status) data.status = dto.status;
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber ? dto.phoneNumber.trim() : null;
    if (dto.bio !== undefined) data.bio = dto.bio ? dto.bio.trim() : null;
    if (dto.title !== undefined) data.title = dto.title ? dto.title.trim() : null;
    if (dto.schoolId !== undefined) data.schoolId = dto.schoolId || null;

    if (dto.certifications !== undefined) {
      data.certifications = typeof dto.certifications === 'string' ? JSON.parse(dto.certifications) : dto.certifications;
    }
    if (dto.achievements !== undefined) {
      data.achievements = typeof dto.achievements === 'string' ? JSON.parse(dto.achievements) : dto.achievements;
    }

    if (dto.courseIds && Array.isArray(dto.courseIds)) {
      data.taughtCourses = {
        set: dto.courseIds.map((cId) => ({ id: cId })),
      };
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        school: { select: { id: true, name: true, acronym: true } },
        taughtCourses: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        school: { select: { id: true, name: true, acronym: true } },
        department: { select: { id: true, name: true, faculty: { select: { id: true, name: true } } } },
        taughtCourses: { select: { id: true, code: true, name: true, unit: true, semester: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [pastQuestionsCount, materialsCount, totalContentCount] = await Promise.all([
      this.prisma.content.count({
        where: { uploaderId: userId, type: 'past_question' },
      }),
      this.prisma.content.count({
        where: { uploaderId: userId, type: { not: 'past_question' } },
      }),
      this.prisma.content.count({
        where: { uploaderId: userId },
      }),
    ]);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      matricNumber: user.matricNumber,
      level: user.level,
      profileImageUrl: user.profileImageUrl,
      bio: user.bio,
      title: user.title,
      certifications: user.certifications || [],
      achievements: user.achievements || [],
      school: user.school,
      department: user.department,
      taughtCourses: user.taughtCourses,
      pastQuestionsCount,
      materialsCount,
      totalContentCount,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: any, file?: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let profileImageUrl = dto.profileImageUrl !== undefined ? dto.profileImageUrl : undefined;
    if (file) {
      profileImageUrl = await this.supabaseStorage.uploadFile(file);
    }

    const data: any = {};
    if (dto.fullName) data.fullName = dto.fullName.trim();
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber ? dto.phoneNumber.trim() : null;
    if (dto.bio !== undefined) data.bio = dto.bio ? dto.bio.trim() : null;
    if (dto.title !== undefined) data.title = dto.title ? dto.title.trim() : null;
    if (profileImageUrl !== undefined) data.profileImageUrl = profileImageUrl;

    if (dto.certifications !== undefined) {
      try {
        data.certifications = typeof dto.certifications === 'string' ? JSON.parse(dto.certifications) : dto.certifications;
      } catch {
        data.certifications = dto.certifications;
      }
    }

    if (dto.achievements !== undefined) {
      try {
        data.achievements = typeof dto.achievements === 'string' ? JSON.parse(dto.achievements) : dto.achievements;
      } catch {
        data.achievements = dto.achievements;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.getProfile(userId);
  }

  async findAll(query: { role?: Role; schoolId?: string; departmentId?: string; search?: string }) {
    const { role, schoolId, departmentId, search } = query;

    const where: any = {};
    if (role) where.role = role;
    if (departmentId) where.departmentId = departmentId;
    else if (schoolId) where.schoolId = schoolId;

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { matricNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    let users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        status: true,
        matricNumber: true,
        level: true,
        profileImageUrl: true,
        bio: true,
        title: true,
        certifications: true,
        achievements: true,
        school: { select: { id: true, name: true, acronym: true } },
        department: { select: { id: true, name: true } },
        taughtCourses: { select: { id: true, code: true, name: true } },
        classRepAssignments: { select: { id: true, courseId: true, active: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (users.length === 0 && role === Role.STUDENT) {
      const fallbackWhere: any = { role: Role.STUDENT };
      if (schoolId) fallbackWhere.schoolId = schoolId;
      if (search) fallbackWhere.OR = where.OR;

      users = await this.prisma.user.findMany({
        where: fallbackWhere,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          status: true,
          matricNumber: true,
          level: true,
          profileImageUrl: true,
          bio: true,
          title: true,
          certifications: true,
          achievements: true,
          school: { select: { id: true, name: true, acronym: true } },
          department: { select: { id: true, name: true } },
          taughtCourses: { select: { id: true, code: true, name: true } },
          classRepAssignments: { select: { id: true, courseId: true, active: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Enrich lecturers with past questions and materials count
    const enrichedUsers = await Promise.all(
      users.map(async (u) => {
        if (u.role === Role.LECTURER) {
          const [pastQuestionsCount, materialsCount] = await Promise.all([
            this.prisma.content.count({ where: { uploaderId: u.id, type: 'past_question' } }),
            this.prisma.content.count({ where: { uploaderId: u.id, type: { not: 'past_question' } } }),
          ]);
          return {
            ...u,
            pastQuestionsCount,
            materialsCount,
          };
        }
        return u;
      })
    );

    return enrichedUsers;
  }

  async findOne(id: string) {
    return this.getProfile(id);
  }

  async updateUserStatus(id: string, status: string) {
    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, email: true, status: true },
    });
  }

  async savePushToken(userId: string, pushToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pushToken },
      select: { id: true, email: true, pushToken: true },
    });
  }

  async uploadDocument(file: Express.Multer.File) {
    const url = await this.supabaseStorage.uploadFile(file);
    return {
      url,
      fileName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  async removeUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.delete({ where: { id } });
  }
}
