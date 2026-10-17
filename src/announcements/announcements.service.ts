import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { sendExpoPushNotification } from '../common/push-notification.helper';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseStorage: SupabaseStorageService,
  ) {}

  private checkManagePermission(announcement: any, user: any) {
    if (!user) return;
    const userId = user.userId || user.id;
    const role = user.role;

    if (role === 'SUPER_ADMIN') {
      return;
    }

    if (role === 'SCHOOL_ADMIN') {
      if (announcement.author?.role === 'SUPER_ADMIN') {
        throw new ForbiddenException('School admins cannot modify platform announcements');
      }
      if (announcement.schoolId && user.schoolId && announcement.schoolId !== user.schoolId) {
        throw new ForbiddenException('You can only modify announcements within your institution');
      }
      return;
    }

    if (role === 'LECTURER') {
      if (announcement.authorId !== userId) {
        throw new ForbiddenException('Lecturers can only modify their own announcements');
      }
      return;
    }

    throw new ForbiddenException('Unauthorized to modify this announcement');
  }

  async create(data: any, authorId: string, file?: Express.Multer.File) {
    let imageUrl = data.imageUrl || null;
    if (file) {
      imageUrl = await this.supabaseStorage.uploadFile(file);
    }

    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      include: {
        classRepAssignments: { where: { active: true } },
        department: true,
      },
    });

    const isClassRep =
      author?.role === 'STUDENT' ||
      (author?.classRepAssignments && author.classRepAssignments.length > 0) ||
      Boolean(data.isClassRep);

    let departmentId = data.departmentId && data.departmentId.trim() !== '' ? data.departmentId : null;
    let level = data.level && data.level.trim() !== '' ? data.level.trim() : null;
    let schoolId = data.schoolId && data.schoolId.trim() !== '' ? data.schoolId : (author?.schoolId || null);
    let audienceType = data.audienceType || 'ALL';

    if (isClassRep) {
      // Class rep announcements are strictly for students in their department and level
      departmentId = author?.departmentId || departmentId;
      level = author?.level || level || '100';
      audienceType = 'CLASS_REP';
    } else if (author?.role === 'LECTURER') {
      if (!departmentId && author?.departmentId) {
        departmentId = author.departmentId;
      }
    }

    const created = await this.prisma.announcement.create({
      data: {
        title: data.title || 'Announcement',
        message: data.message || data.content || '',
        audienceType,
        type: data.type || 'GENERAL',
        imageUrl: imageUrl,
        courseId: data.courseId && data.courseId.trim() !== '' ? data.courseId : null,
        schoolId: schoolId && schoolId.trim() !== '' ? schoolId : null,
        departmentId: departmentId && departmentId.trim() !== '' ? departmentId : null,
        level: level && level.trim() !== '' ? level.trim() : null,
        authorId,
      },
      include: {
        author: { select: { fullName: true, role: true } },
        course: true,
        school: true,
        department: true,
      },
    });

    // Asynchronously dispatch Expo push notifications
    (async () => {
      try {
        let userFilter: any = { pushToken: { not: null } };
        if (schoolId) {
          userFilter.schoolId = schoolId;
        }
        if (departmentId) {
          userFilter.departmentId = departmentId;
        }
        if (level) {
          const numLevel = level.replace(/[^0-9]/g, '');
          userFilter.OR = [
            { level: level },
            { level: numLevel },
            { level: `${numLevel}L` },
          ];
        }

        const usersWithToken = await this.prisma.user.findMany({
          where: userFilter,
          select: { pushToken: true },
        });

        const tokens = usersWithToken
          .map((u) => u.pushToken)
          .filter((t): t is string => Boolean(t));

        if (tokens.length > 0) {
          const previewMessage =
            data.message && data.message.length > 120
              ? `${data.message.slice(0, 117)}...`
              : data.message || 'New announcement available';

          await sendExpoPushNotification(
            tokens,
            data.title || 'Campus Announcement',
            previewMessage,
            { type: 'announcement', id: created.id, title: data.title }
          );
        }
      } catch (err) {
        console.warn('Failed to dispatch announcement push notifications:', err);
      }
    })();

    return created;
  }

  async findAll(user?: any) {
    const currentUserId = user?.userId || user?.id;
    let where: any = {};

    if (user) {
      if (user.role === 'SUPER_ADMIN') {
        // Super admin sees all announcements across campuses, including class rep announcements
        where = {};
      } else if (user.role === 'LECTURER' || user.role === 'SCHOOL_ADMIN') {
        // Requirement 4: Announcements created by class rep shouldn't show in the lecturer and school admin dashboard only super admin.
        const conditions: any[] = [
          { author: { role: { not: 'STUDENT' } } },
          { audienceType: { notIn: ['CLASS_REP', 'class_rep', 'REP', 'rep'] } },
        ];

        const userSchoolId = user.schoolId;
        if (userSchoolId) {
          where = {
            AND: [
              ...conditions,
              {
                OR: [
                  { author: { role: 'SUPER_ADMIN' } },
                  { schoolId: userSchoolId },
                  { author: { schoolId: userSchoolId } },
                  { schoolId: null },
                ],
              },
            ],
          };
        } else {
          where = {
            AND: conditions,
          };
        }
      } else if (user.role === 'STUDENT') {
        const student = await this.prisma.user.findUnique({
          where: { id: currentUserId },
          select: {
            id: true,
            schoolId: true,
            departmentId: true,
            level: true,
            enrollments: { select: { courseId: true } },
          },
        });

        const studentSchoolId = student?.schoolId || user.schoolId;
        const studentDeptId = student?.departmentId || user.departmentId;
        const studentLevelRaw = student?.level || user.level || '100';
        const studentLevelNum = studentLevelRaw.replace(/[^0-9]/g, '') || '100';

        const levelVariants = [
          studentLevelNum,
          `${studentLevelNum}L`,
          `${studentLevelNum} Level`,
          studentLevelRaw,
        ];

        // 1. Explicit enrollments
        const enrolledCourseIds = student?.enrollments?.map((e) => e.courseId) || [];

        // 2. Department & level courses that the student is offering as part of their curriculum
        let deptLevelCourseIds: string[] = [];
        if (studentDeptId) {
          const deptCourses = await this.prisma.course.findMany({
            where: {
              departmentId: studentDeptId,
              ...(studentSchoolId ? { schoolId: studentSchoolId } : {}),
              OR: [
                { level: studentLevelNum },
                { level: `${studentLevelNum}L` },
                { level: `${studentLevelNum} Level` },
                { level: null },
                { level: '' },
              ],
            },
            select: { id: true },
          });
          deptLevelCourseIds = deptCourses.map((c) => c.id);
        }

        const studentOfferedCourseIds = Array.from(
          new Set([...enrolledCourseIds, ...deptLevelCourseIds]),
        );

        const schoolMatchCondition = studentSchoolId
          ? {
              OR: [
                { schoolId: studentSchoolId },
                { schoolId: null },
                { author: { schoolId: studentSchoolId } },
                { author: { schoolId: null } },
              ],
            }
          : {};

        const studentScopeOr: any[] = [
          // 1. Announcements authored by the user themselves
          { authorId: currentUserId },

          // 2. Super Admin announcements (platform-wide broadcasts)
          { author: { role: 'SUPER_ADMIN' } },

          // 3. School Admin announcements (general school updates, or targeted to department/level if specified)
          {
            author: { role: 'SCHOOL_ADMIN' },
            ...schoolMatchCondition,
            AND: [
              {
                OR: [
                  { departmentId: null },
                  ...(studentDeptId ? [{ departmentId: studentDeptId }] : []),
                ],
              },
              {
                OR: [
                  { level: null },
                  { level: '' },
                  { level: 'ALL' },
                  ...levelVariants.map((v) => ({ level: v })),
                ],
              },
            ],
          },

          // 4. Class Rep announcements (strictly fixed to the class rep's department and level)
          {
            audienceType: 'CLASS_REP',
            ...schoolMatchCondition,
            ...(studentDeptId ? { departmentId: studentDeptId } : {}),
            level: { in: levelVariants },
          },

          // 5. Lecturer General Updates (general campus/faculty announcements posted by lecturers, not specific to course/level)
          {
            author: { role: 'LECTURER' },
            type: { not: 'LECTURER_UPDATE' },
            courseId: null,
            audienceType: { not: 'CLASS_REP' },
            ...schoolMatchCondition,
            AND: [
              {
                OR: [
                  { level: null },
                  { level: '' },
                  { level: 'ALL' },
                ],
              },
              {
                OR: [
                  { departmentId: null },
                  ...(studentDeptId ? [{ departmentId: studentDeptId }] : []),
                ],
              },
            ],
          },

          // 6. Lecturer Updates:
          // Student sees the announcement if they are in that particular level OR offering that course
          {
            author: { role: 'LECTURER' },
            ...schoolMatchCondition,
            AND: [
              {
                OR: [
                  // Targeted by Level: student must be in that particular level
                  {
                    level: { in: levelVariants },
                    OR: [
                      { departmentId: null },
                      ...(studentDeptId ? [{ departmentId: studentDeptId }] : []),
                    ],
                  },
                  // Targeted by Course: student must be offering that course
                  ...(studentOfferedCourseIds.length > 0
                    ? [{ courseId: { in: studentOfferedCourseIds } }]
                    : []),
                ],
              },
            ],
          },
        ];

        where = { OR: studentScopeOr };
      }
    }

    const list = await this.prisma.announcement.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            role: true,
            email: true,
            phoneNumber: true,
            bio: true,
            title: true,
            profileImageUrl: true,
            school: { select: { id: true, name: true } },
            department: { select: { id: true, name: true, faculty: { select: { name: true } } } },
          },
        },
        course: true,
        school: true,
        department: { select: { id: true, name: true } },
        likes: true,
        comments: {
          include: { author: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return list.map((a) => {
      const likesCount = a.likes.length;
      const hasLiked = currentUserId
        ? a.likes.some((l) => l.userId === currentUserId)
        : false;
      const mappedComments = a.comments.map((c) => ({
        id: c.id,
        text: c.content,
        author: c.author?.fullName || 'Student',
        createdAt: c.createdAt.toISOString(),
        likes: this.getCommentLikesCount(c.id),
        hasLiked: this.hasUserLikedComment(c.id, currentUserId),
        reactions: this.getCommentReactionsList(c.id, currentUserId),
      }));

      return {
        id: a.id,
        title: a.title,
        message: a.message,
        content: a.message,
        audienceType: a.audienceType,
        type: a.type,
        imageUrl: a.imageUrl,
        level: a.level,
        departmentId: a.departmentId,
        department: a.department ? { id: a.department.id, name: a.department.name } : null,
        author: a.author?.fullName || 'Campus Staff',
        authorName: a.author?.fullName || 'Campus Staff',
        authorRole: a.author?.role,
        authorId: a.authorId,
        authorProfile: a.author
          ? {
              id: a.author.id,
              fullName: a.author.fullName,
              name: a.author.fullName,
              role: a.author.role,
              email: a.author.email,
              phoneNumber: a.author.phoneNumber,
              phone: a.author.phoneNumber,
              bio: a.author.bio,
              title: a.author.title,
              profileImageUrl: a.author.profileImageUrl,
              school: a.author.school?.name,
              department: a.author.department?.name,
              faculty: (a.author.department as any)?.faculty?.name,
            }
          : null,
        courseId: a.courseId,
        schoolId: a.schoolId,
        createdAt: a.createdAt.toISOString(),
        likes: likesCount,
        hasLiked,
        comments: mappedComments,
      };
    });
  }

  async findOne(id: string, user?: any) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            role: true,
            email: true,
            phoneNumber: true,
            bio: true,
            title: true,
            profileImageUrl: true,
            school: { select: { id: true, name: true } },
            department: { select: { id: true, name: true, faculty: { select: { name: true } } } },
          },
        },
        course: true,
        school: true,
        department: { select: { id: true, name: true } },
        likes: true,
        comments: {
          include: { author: { select: { fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const currentUserId = user?.userId || user?.id;
    const likesCount = announcement.likes.length;
    const hasLiked = currentUserId
      ? announcement.likes.some((l) => l.userId === currentUserId)
      : false;
    const mappedComments = announcement.comments.map((c) => ({
      id: c.id,
      text: c.content,
      author: c.author?.fullName || 'Student',
      createdAt: c.createdAt.toISOString(),
      likes: this.getCommentLikesCount(c.id),
      hasLiked: this.hasUserLikedComment(c.id, currentUserId),
      reactions: this.getCommentReactionsList(c.id, currentUserId),
    }));

    return {
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      content: announcement.message,
      audienceType: announcement.audienceType,
      type: announcement.type,
      imageUrl: announcement.imageUrl,
      level: announcement.level,
      departmentId: announcement.departmentId,
      department: announcement.department ? { id: announcement.department.id, name: announcement.department.name } : null,
      author: announcement.author?.fullName || 'Campus Staff',
      authorName: announcement.author?.fullName || 'Campus Staff',
      authorRole: announcement.author?.role,
      authorId: announcement.authorId,
      authorProfile: announcement.author
        ? {
            id: announcement.author.id,
            fullName: announcement.author.fullName,
            name: announcement.author.fullName,
            role: announcement.author.role,
            email: announcement.author.email,
            phoneNumber: announcement.author.phoneNumber,
            phone: announcement.author.phoneNumber,
            bio: announcement.author.bio,
            title: announcement.author.title,
            profileImageUrl: announcement.author.profileImageUrl,
            school: announcement.author.school?.name,
            department: announcement.author.department?.name,
            faculty: (announcement.author.department as any)?.faculty?.name,
          }
        : null,
      courseId: announcement.courseId,
      schoolId: announcement.schoolId,
      createdAt: announcement.createdAt.toISOString(),
      likes: likesCount,
      hasLiked,
      comments: mappedComments,
    };
  }

  async update(id: string, data: any, file?: Express.Multer.File, user?: any) {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
      include: { author: { select: { id: true, role: true, schoolId: true } } },
    });
    if (!existing) throw new NotFoundException('Announcement not found');

    this.checkManagePermission(existing, user);

    let imageUrl = data.imageUrl !== undefined ? data.imageUrl : undefined;
    if (file) {
      imageUrl = await this.supabaseStorage.uploadFile(file);
    }
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.message !== undefined || data.content !== undefined) {
      updateData.message = data.message || data.content || '';
    }
    if (data.audienceType !== undefined) updateData.audienceType = data.audienceType;
    if (data.type !== undefined) updateData.type = data.type;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (data.level !== undefined) {
      updateData.level = data.level && data.level.trim() !== '' ? data.level.trim() : null;
    }
    if (data.departmentId !== undefined) {
      updateData.departmentId = data.departmentId && data.departmentId.trim() !== '' ? data.departmentId : null;
    }
    if (data.courseId !== undefined) {
      updateData.courseId = data.courseId && data.courseId.trim() !== '' ? data.courseId : null;
    }
    if (data.schoolId !== undefined) {
      updateData.schoolId = data.schoolId && data.schoolId.trim() !== '' ? data.schoolId : null;
    }

    return this.prisma.announcement.update({
      where: { id },
      data: updateData,
      include: {
        author: { select: { fullName: true, role: true } },
        course: true,
        school: true,
        department: true,
      },
    });
  }

  async remove(id: string, user?: any) {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
      include: { author: { select: { id: true, role: true, schoolId: true } } },
    });
    if (!existing) throw new NotFoundException('Announcement not found');

    this.checkManagePermission(existing, user);

    return this.prisma.announcement.delete({ where: { id } });
  }

  async toggleLike(announcementId: string, userId: string) {
    const existing = await this.prisma.announcementLike.findUnique({
      where: {
        announcementId_userId: {
          announcementId,
          userId,
        },
      },
    });

    if (existing) {
      await this.prisma.announcementLike.delete({
        where: { id: existing.id },
      });
    } else {
      await this.prisma.announcementLike.create({
        data: {
          announcementId,
          userId,
        },
      });
    }

    const likesCount = await this.prisma.announcementLike.count({
      where: { announcementId },
    });

    return {
      liked: !existing,
      likesCount,
    };
  }

  // Comment likes: commentId -> Set of userIds
  private commentLikes: Map<string, Set<string>> = new Map();
  // Comment reactions: commentId -> emoji -> Set of userIds
  private commentReactions: Map<string, Map<string, Set<string>>> = new Map();

  private getCommentLikesCount(commentId: string): number {
    return this.commentLikes.get(commentId)?.size || 0;
  }

  private hasUserLikedComment(commentId: string, userId?: string): boolean {
    if (!userId) return false;
    return Boolean(this.commentLikes.get(commentId)?.has(userId));
  }

  private getCommentReactionsList(commentId: string, currentUserId?: string) {
    const emojiMap = this.commentReactions.get(commentId);
    if (!emojiMap || emojiMap.size === 0) return [];

    const result: { emoji: string; count: number; userIds: string[]; hasReacted: boolean }[] = [];
    emojiMap.forEach((users, emoji) => {
      if (users.size > 0) {
        result.push({
          emoji,
          count: users.size,
          userIds: Array.from(users),
          hasReacted: Boolean(currentUserId && users.has(currentUserId)),
        });
      }
    });
    return result;
  }

  async getComments(announcementId: string, currentUserId?: string) {
    const comments = await this.prisma.announcementComment.findMany({
      where: { announcementId },
      include: { author: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return comments.map((c) => ({
      id: c.id,
      text: c.content,
      author: c.author?.fullName || 'Student',
      createdAt: c.createdAt.toISOString(),
      likes: this.getCommentLikesCount(c.id),
      hasLiked: this.hasUserLikedComment(c.id, currentUserId),
      reactions: this.getCommentReactionsList(c.id, currentUserId),
    }));
  }

  async addComment(announcementId: string, authorId: string, content: string) {
    if (!content || !content.trim()) {
      throw new BadRequestException('Comment text cannot be empty');
    }

    const comment = await this.prisma.announcementComment.create({
      data: {
        announcementId,
        authorId,
        content: content.trim(),
      },
      include: { author: { select: { fullName: true } } },
    });

    return {
      id: comment.id,
      text: comment.content,
      author: comment.author?.fullName || 'Student',
      createdAt: comment.createdAt.toISOString(),
      likes: 0,
      hasLiked: false,
      reactions: [],
    };
  }

  async toggleCommentLike(commentId: string, userId: string) {
    const comment = await this.prisma.announcementComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    if (!this.commentLikes.has(commentId)) {
      this.commentLikes.set(commentId, new Set());
    }

    const userSet = this.commentLikes.get(commentId)!;
    let liked = false;
    if (userSet.has(userId)) {
      userSet.delete(userId);
      liked = false;
    } else {
      userSet.add(userId);
      liked = true;
    }

    return {
      commentId,
      liked,
      likesCount: userSet.size,
    };
  }

  async reactToComment(commentId: string, userId: string, emoji: string) {
    if (!emoji || !emoji.trim()) {
      throw new BadRequestException('Emoji cannot be empty');
    }

    const comment = await this.prisma.announcementComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const cleanEmoji = emoji.trim();
    if (!this.commentReactions.has(commentId)) {
      this.commentReactions.set(commentId, new Map());
    }

    const emojiMap = this.commentReactions.get(commentId)!;
    if (!emojiMap.has(cleanEmoji)) {
      emojiMap.set(cleanEmoji, new Set());
    }

    const usersSet = emojiMap.get(cleanEmoji)!;
    let reacted = false;
    if (usersSet.has(userId)) {
      usersSet.delete(userId);
      reacted = false;
    } else {
      usersSet.add(userId);
      reacted = true;
    }

    const reactions = this.getCommentReactionsList(commentId, userId);
    return {
      commentId,
      emoji: cleanEmoji,
      reacted,
      reactions,
    };
  }
}
