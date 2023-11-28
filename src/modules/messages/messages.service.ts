import { Injectable, ForbiddenException } from '@nestjs/common';
import {
  RoomWebDto,
  PrivateRoomQueryDto,
  MessageWebDto,
  RoomDataDto,
  messageAnalysisDto,
} from 'micro-dto';
import { MessagesRepoService } from 'src/modules/messages-repo/messages.repo.service';

@Injectable()
export class MessagesService {
  constructor(private messagesRepoService: MessagesRepoService) {}

  async getPrivateRoom(
    param: PrivateRoomQueryDto,
  ): Promise<RoomDataDto | undefined> {
    let privateRoom = await this.messagesRepoService.getPrivateRoom(param);

    if (!privateRoom)
      privateRoom = await this.messagesRepoService.createPrivateRoom(param);

    const messages = await this.messagesRepoService.getRoomMessages({
      roomId: privateRoom.id,
    });

    return {
      room: privateRoom,
      messages: messages?.reverse(),
    };
  }

  async receiveMessage(
    param: MessageWebDto,
  ): Promise<MessageWebDto | undefined> {
    const { id, user_id } = param;
    const messageRoom: RoomWebDto = await this.messagesRepoService.getUserRoom({
      id,
      user_id,
    });

    if (!messageRoom) {
      throw new ForbiddenException(`Room ${id} forbidden for user ${user_id}`);
    }

    const newMessage = await this.messagesRepoService.saveMessage(param);

    return newMessage;
  }

  async receiveAnalysis(param: { id: string; analysis: messageAnalysisDto }) {
    return this.messagesRepoService.saveAnalysis(param);
  }
}
