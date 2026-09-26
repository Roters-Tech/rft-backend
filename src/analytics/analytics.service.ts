import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardMetrics(schoolId?: string) {
    const whereClause = schoolId ? { schoolId } : {};
    const userWhereClause = schoolId ? { schoolId } : {};

    const [totalSchools, totalStudents, totalLecturers, totalCourses, totalContent, totalRevenue, activeSubscriptions] = await Promise.all([
      this.prisma.school.count({ where: { status: { not: 'deleted' } } }),
      this.prisma.user.count({ where: { ...userWhereClause, role: 'STUDENT' } }),
      this.prisma.user.count({ where: { ...userWhereClause, role: 'LECTURER' } }),
      this.prisma.course.count({ where: whereClause }),
      this.prisma.content.count({ where: whereClause }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'success' },
      }),
      this.prisma.subscription.count({ where: { status: 'active' } }),
    ]);

    let schoolCapacity = 10;
    let currentPlanName: string | null = null;
    let nextPlanId: string | null = null;
    let planExpiresAt: Date | null = null;
    if (schoolId) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        include: {
          subscriptions: {
            where: { status: 'active' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      const activeSub = school?.subscriptions?.[0];
      currentPlanName = activeSub?.planName || null;
      schoolCapacity = school?.capacity ?? (activeSub?.planName ? 5000 : 10);
      nextPlanId = school?.nextPlanId || null;
      planExpiresAt = school?.planExpiresAt || null;
    }

    return {
      totalSchools,
      totalStudents,
      totalLecturers,
      totalCourses,
      totalContent,
      totalRevenue: totalRevenue._sum.amount || 0,
      activeSubscriptions,
      pastQuestionsCount: totalContent,
      schoolCapacity,
      currentPlanName,
      nextPlanId,
      planExpiresAt,
    };
  }
}

