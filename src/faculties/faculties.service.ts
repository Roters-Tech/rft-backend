import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FacultiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string; schoolId: string; deanName?: string; capacityTarget?: number }) {
    if (!data.name || !data.schoolId) {
      throw new BadRequestException('Faculty name and schoolId are required.');
    }

    const trimmedName = data.name.trim();
    const existing = await this.prisma.faculty.findFirst({
      where: {
        schoolId: data.schoolId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new BadRequestException(`Faculty "${trimmedName}" already exists in your institution.`);
    }

    return this.prisma.faculty.create({
      data: {
        name: trimmedName,
        schoolId: data.schoolId,
        deanName: data.deanName?.trim() || null,
        capacityTarget: data.capacityTarget ? Number(data.capacityTarget) : null,
        status: 'active',
      },
      include: { departments: true },
    });
  }

  async findAllBySchool(schoolId: string) {
    return this.prisma.faculty.findMany({
      where: { schoolId },
      include: { departments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPublic() {
    return this.prisma.faculty.findMany({
      include: { departments: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAllPublicDepartments(facultyId?: string) {
    return this.prisma.department.findMany({
      where: facultyId ? { facultyId } : {},
      include: { faculty: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.faculty.update({
      where: { id },
      data,
      include: { departments: true },
    });
  }

  async delete(id: string) {
    return this.prisma.faculty.delete({ where: { id } });
  }

  async deactivate(id: string, reason: string) {
    return this.prisma.faculty.update({
      where: { id },
      data: { status: 'deactivated' },
    });
  }

  async createDepartment(data: { name: string; facultyId: string; schoolId: string }) {
    if (!data.name || !data.facultyId || !data.schoolId) {
      throw new BadRequestException('Department name, facultyId, and schoolId are required.');
    }

    const trimmedName = data.name.trim();
    const existing = await this.prisma.department.findFirst({
      where: {
        facultyId: data.facultyId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new BadRequestException(`Department "${trimmedName}" already exists in this faculty.`);
    }

    return this.prisma.department.create({
      data: {
        name: trimmedName,
        facultyId: data.facultyId,
        schoolId: data.schoolId,
      },
    });
  }

  async deleteDepartment(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }
}
