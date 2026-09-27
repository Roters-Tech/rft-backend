import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('courses/:courseId/messages')
  getCourseMessages(@Req() req: any, @Param('courseId') courseId: string) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    return this.chatService.getCourseMessages(courseId, userId);
  }

  @Post('courses/:courseId/messages')
  sendMessage(@Req() req: any, @Param('courseId') courseId: string, @Body() dto: { message: string; isAnonymous?: boolean }) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    return this.chatService.sendMessage(courseId, userId, dto);
  }

  @Post('messages/:messageId/reactions')
  reactToMessage(
    @Req() req: any,
    @Param('messageId') messageId: string,
    @Body() dto: { emoji: string }
  ) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    return this.chatService.reactToMessage(messageId, userId, dto.emoji);
  }
}
