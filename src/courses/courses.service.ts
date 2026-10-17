import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: any, creatorUser?: any) {
    const { lecturerIds, facultyId, ...rest } = dto;
    const data: any = { ...rest };

    if (data.unit !== undefined && data.unit !== null && data.unit !== '') {
      data.unit = Number(data.unit);
    } else {
      delete data.unit;
    }
    if (data.credits !== undefined && data.credits !== null && data.credits !== '') {
      data.credits = Number(data.credits);
    } else {
      delete data.credits;
    }
    if (data.semester !== undefined && data.semester !== null && data.semester !== '') {
      data.semester = Number(data.semester);
    } else {
      delete data.semester;
    }

    if (!data.schoolId && creatorUser?.schoolId) {
      data.schoolId = creatorUser.schoolId;
    }
    if (!data.departmentId && creatorUser?.departmentId) {
      data.departmentId = creatorUser.departmentId;
    }

    if ((!data.schoolId || !data.departmentId) && creatorUser?.id) {
      const u = await this.prisma.user.findUnique({
        where: { id: creatorUser.id },
        select: { schoolId: true, departmentId: true },
      });
      if (u) {
        if (!data.schoolId && u.schoolId) data.schoolId = u.schoolId;
        if (!data.departmentId && u.departmentId) data.departmentId = u.departmentId;
      }
    }

    if (data.departmentId && !data.schoolId) {
      const dept = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (dept) data.schoolId = dept.schoolId;
    }

    if (!data.schoolId) {
      const school = await this.prisma.school.findFirst();
      if (school) data.schoolId = school.id;
    }
    if (!data.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: data.schoolId ? { schoolId: data.schoolId } : undefined,
      });
      if (dept) data.departmentId = dept.id;
    }

    const idsToConnect = new Set<string>();
    if (lecturerIds && Array.isArray(lecturerIds)) {
      lecturerIds.forEach((id: string) => idsToConnect.add(id));
    }
    if (creatorUser?.id && (creatorUser?.role === 'LECTURER' || creatorUser?.role === 'lecturer')) {
      idsToConnect.add(creatorUser.id);
    }

    if (idsToConnect.size > 0) {
      data.lecturers = {
        connect: Array.from(idsToConnect).map((id) => ({ id })),
      };
    }

    return this.prisma.course.create({
      data,
      include: {
        school: true,
        department: { include: { faculty: true } },
        lecturers: true,
      },
    });
  }

  async findAllAdmin(user?: any) {
    const where: any = {};
    if (user && user.role === 'SCHOOL_ADMIN' && user.schoolId) {
      where.schoolId = user.schoolId;
    }

    return this.prisma.course.findMany({
      where,
      include: {
        school: true,
        department: { include: { faculty: true } },
        lecturers: true,
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllStudent(query?: { schoolId?: string; lecturerId?: string }, user?: any) {
    const where: any = { status: 'active' };
    if (user && user.role !== 'SUPER_ADMIN') {
      where.schoolId = user.schoolId;
    } else if (query?.schoolId) {
      where.schoolId = query.schoolId;
    }
    
    if (query?.lecturerId) {
      where.lecturers = { some: { id: query.lecturerId } };
    }

    return this.prisma.course.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        level: true,
        module: true,
        department: { select: { id: true, name: true } },
        school: { select: { id: true, name: true, acronym: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: { lecturers: { select: { id: true, fullName: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async enroll(studentId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    return this.prisma.enrollment.upsert({
      where: {
        studentId_courseId: { studentId, courseId },
      },
      create: { studentId, courseId },
      update: {},
      include: { course: true },
    });
  }

  async unenroll(studentId: string, courseId: string) {
    return this.prisma.enrollment.deleteMany({
      where: { studentId, courseId },
    });
  }

  async getMyCourses(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        course: {
          include: {
            department: { select: { id: true, name: true } },
            lecturers: { select: { id: true, fullName: true, email: true } },
            contents: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return enrollments.map((e) => ({
      ...e.course,
      progress: e.progress,
      enrolledAt: e.createdAt,
      resourcesCount: e.course.contents.filter((c) => c.type === 'resource').length,
      pastQuestionsCount: e.course.contents.filter((c) => c.type === 'past_question').length,
    }));
  }

  async getEnrolledStudents(courseId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            fullName: true,
            matricNumber: true,
            level: true,
            phoneNumber: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
    });

    return enrollments.map((e) => e.student);
  }

  async update(id: string, data: any) {
    const { lecturerIds, ...rest } = data;
    const updateData: any = { ...rest };
    if (lecturerIds !== undefined && Array.isArray(lecturerIds)) {
      updateData.lecturers = {
        set: lecturerIds.map((lId: string) => ({ id: lId })),
      };
    }
    return this.prisma.course.update({
      where: { id },
      data: updateData,
      include: {
        school: true,
        department: { include: { faculty: true } },
        lecturers: true,
      },
    });
  }

  async delete(id: string) {
    await this.prisma.announcement.updateMany({
      where: { courseId: id },
      data: { courseId: null },
    });
    return this.prisma.course.delete({ where: { id } });
  }
}
