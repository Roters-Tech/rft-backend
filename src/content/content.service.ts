import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { Role } from '@prisma/client';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly supabaseStorage: SupabaseStorageService,
  ) {}

  async create(data: any, userRole?: Role, userId?: string, file?: Express.Multer.File) {
    const defaultPrices = await this.settingsService.getPricingSettings();
    const type = data.type || 'resource';
    const defaultPrice = type === 'slides' ? defaultPrices.slidePrice : (type === 'past_question' ? defaultPrices.pastQuestionPrice : defaultPrices.courseMaterialPrice);

    // Rule: Lecturer uploads automatically default to Paid
    let isPaid = data.isPaid !== undefined ? (String(data.isPaid) === 'true' || data.isPaid === true) : true;
    if (userRole === Role.LECTURER) {
      isPaid = true;
    }

    const price = isPaid ? (data.price && Number(data.price) > 0 ? Number(data.price) : defaultPrice) : 0;
    const rawExt = file ? file.originalname.split('.').pop()?.toLowerCase() : (data.title ? data.title.split('.').pop()?.toLowerCase() : 'pdf');
    const fileExtension = rawExt && rawExt.length <= 5 ? rawExt : 'pdf';

    let downloadUrl = data.downloadUrl;
    if (file) {
      downloadUrl = await this.supabaseStorage.uploadFile(file);
    } else if (!downloadUrl) {
      const port = process.env.PORT || 3006;
      const baseUrl =
        process.env.APP_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);
      downloadUrl = `${baseUrl}/uploads/sample_past_question.pdf`;
    }

    return this.prisma.content.create({
      data: {
        title: data.title,
        type,
        fileType: fileExtension,
        previewUrl: data.previewUrl || null,
        downloadUrl,
        visibility: data.visibility || 'public',
        isPaid,
        price,
        courseId: data.courseId || null,
        schoolId: data.schoolId || null,
        uploaderId: userId || data.uploaderId || null,
      },
      include: { course: true, school: true, uploader: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async createBulk(items: any[], files: Express.Multer.File[], user: { id: string; role: Role; schoolId?: string }) {
    const results: any[] = [];
    const defaultPrices = await this.settingsService.getPricingSettings();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const itemData = items[i] || items[0] || {};
      const originalName = file.originalname;
      const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'pdf';

      try {
        const downloadUrl = await this.supabaseStorage.uploadFile(file);
        const title = itemData.title || originalName.replace(/\.[^/.]+$/, '');
        const type = itemData.type || 'resource';
        const defaultPrice = type === 'slides' ? defaultPrices.slidePrice : (type === 'past_question' ? defaultPrices.pastQuestionPrice : defaultPrices.courseMaterialPrice);

        let isPaid = itemData.isPaid !== undefined ? Boolean(itemData.isPaid) : true;
        if (user.role === Role.LECTURER) {
          isPaid = true;
        }

        const price = isPaid ? (itemData.price && Number(itemData.price) > 0 ? Number(itemData.price) : defaultPrice) : 0;

        const created = await this.prisma.content.create({
          data: {
            title,
            type,
            fileType: fileExtension,
            downloadUrl,
            visibility: 'public',
            isPaid,
            price,
            level: itemData.level || null,
            courseId: itemData.courseId || null,
            schoolId: itemData.schoolId || user.schoolId || null,
            uploaderId: user.id,
          },
          include: { course: true, school: true },
        });

        results.push({
          filename: originalName,
          status: 'success',
          content: created,
        });
      } catch (err: any) {
        results.push({
          filename: originalName,
          status: 'failed',
          error: err.message || 'Failed to upload file',
        });
      }
    }

    return {
      total: files.length,
      successCount: results.filter((r) => r.status === 'success').length,
      failureCount: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  async updatePricing(id: string, dto: { isPaid?: boolean; price?: number }) {
    const existing = await this.prisma.content.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Content not found');

    const defaultPrices = await this.settingsService.getPricingSettings();
    const defaultPrice = existing.type === 'slides' ? defaultPrices.slidePrice : (existing.type === 'past_question' ? defaultPrices.pastQuestionPrice : defaultPrices.courseMaterialPrice);

    const isPaid = dto.isPaid !== undefined ? dto.isPaid : existing.isPaid;
    const price = isPaid ? (dto.price !== undefined ? dto.price : (existing.price || defaultPrice)) : 0;

    return this.prisma.content.update({
      where: { id },
      data: { isPaid, price },
      include: { course: true, school: true, uploader: true },
    });
  }

  async findAll(query?: { uploaderId?: string; schoolId?: string; courseId?: string; type?: string }, user?: any) {
    const where: any = {};
    if (query?.uploaderId) where.uploaderId = query.uploaderId;
    if (user && user.role !== 'SUPER_ADMIN' && user.schoolId) {
      where.OR = [
        { schoolId: user.schoolId },
        { schoolId: null },
      ];
    } else if (query?.schoolId) {
      where.schoolId = query.schoolId;
    }
    if (query?.courseId) where.courseId = query.courseId;
    if (query?.type) where.type = query.type;

    return this.prisma.content.findMany({
      where,
      include: {
        course: {
          include: {
            department: {
              include: { faculty: true },
            },
          },
        },
        school: true,
        uploader: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: { course: true, school: true, uploader: { select: { id: true, fullName: true, role: true } } },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async remove(id: string) {
    return this.prisma.content.delete({ where: { id } });
  }
}
