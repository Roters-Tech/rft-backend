import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  // Map of messageId -> emoji -> Set of userIds
  private messageReactions: Map<string, Map<string, Set<string>>> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  private getFormattedReactions(messageId: string, currentUserId?: string) {
    const emojiMap = this.messageReactions.get(messageId);
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

  async getCourseMessages(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    const messages = await this.prisma.chatMessage.findMany({
      where: { courseId },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((msg) => {
      const reactions = this.getFormattedReactions(msg.id, userId);
      if (msg.isAnonymous) {
        return {
          ...msg,
          reactions,
          sender: {
            id: 'anonymous',
            fullName: 'Anonymous Student',
            email: '',
            role: 'STUDENT',
          },
        };
      }
      return {
        ...msg,
        reactions,
      };
    });
  }

  async sendMessage(courseId: string, userId: string, dto: { message: string; isAnonymous?: boolean }) {
    if (!dto.message || !dto.message.trim()) {
      throw new BadRequestException('Message body cannot be empty');
    }

    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    const created = await this.prisma.chatMessage.create({
      data: {
        courseId,
        senderId: userId,
        message: dto.message.trim(),
        isAnonymous: Boolean(dto.isAnonymous),
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const reactions: any[] = [];
    if (created.isAnonymous) {
      return {
        ...created,
        reactions,
        sender: {
          id: 'anonymous',
          fullName: 'Anonymous Student',
          email: '',
          role: 'STUDENT',
        },
      };
    }

    return {
      ...created,
      reactions,
    };
  }

  async reactToMessage(messageId: string, userId: string, emoji: string) {
    if (!emoji || !emoji.trim()) {
      throw new BadRequestException('Emoji cannot be empty');
    }

    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');

    const cleanEmoji = emoji.trim();
    if (!this.messageReactions.has(messageId)) {
      this.messageReactions.set(messageId, new Map());
    }

    const emojiMap = this.messageReactions.get(messageId)!;
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

    const reactions = this.getFormattedReactions(messageId, userId);
    return {
      messageId,
      emoji: cleanEmoji,
      reacted,
      reactions,
    };
  }
}
