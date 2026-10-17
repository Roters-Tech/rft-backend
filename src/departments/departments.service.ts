import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.department.create({ data });
  }

  async createBatch(schoolId: string, departmentNames: string[]) {
    // 1. Ensure at least one faculty exists for the school
    let faculty = await this.prisma.faculty.findFirst({ where: { schoolId } });
    if (!faculty) {
      faculty = await this.prisma.faculty.create({
        data: {
          name: 'General Faculty',
          schoolId,
        },
      });
    }

    const trimmedNames = departmentNames
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    // 2. Delete departments that were removed from the selection
    await this.prisma.department.deleteMany({
      where: {
        schoolId,
        name: { notIn: trimmedNames },
      },
    });

    // 3. Upsert / create new selected departments
    const resultDeps: any[] = [];
    for (const name of trimmedNames) {
      const existing = await this.prisma.department.findFirst({
        where: { schoolId, name },
      });
      if (!existing) {
        const dep = await this.prisma.department.create({
          data: {
            name,
            schoolId,
            facultyId: faculty.id,
          },
        });
        resultDeps.push(dep);
      } else {
        resultDeps.push(existing);
      }
    }
    return resultDeps;
  }

  async findBySchool(schoolId: string) {
    const deps = await this.prisma.department.findMany({
      where: { schoolId },
      include: {
        faculty: true,
        _count: { select: { courses: true } },
        users: { where: { role: 'STUDENT' }, select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });
    return deps.map((d) => ({
      ...d,
      studentCount: d.users?.length || 0,
    }));
  }

  async findAll() {
    const deps = await this.prisma.department.findMany({
      include: {
        faculty: true,
        _count: { select: { courses: true } },
        users: { where: { role: 'STUDENT' }, select: { id: true } },
        school: true,
      },
      orderBy: { name: 'asc' },
    });
    return deps.map((d) => ({
      ...d,
      studentCount: d.users?.length || 0,
    }));
  }

  async update(id: string, data: any) {
    return this.prisma.department.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }
}
