import { Model } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Room, RoomDocument } from './rooms.schema';
import { Message, MessageDocument } from './messages.schema';
import {
  RoomWebDto,
  MessageWebDto,
  PrivateRoomQueryDto,
  UserRoomQueryDto,
  messageAnalysisDto,
  messageDto,
} from 'micro-dto';

@Injectable()
export class MessagesRepoService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  getWebRoomDto(roomDoc: RoomDocument): RoomWebDto {
    const { _id, user_ids, type, created_at } = roomDoc;
    return {
      id: _id.toString(),
      user_ids: user_ids.map((id) => id.toString()),
      type,
      created_at,
    };
  }

  getWebMessageDto(messageDoc: MessageDocument): MessageWebDto {
    const { _id, uuid, message, room_id, user_id, created_at } = messageDoc;
    return {
      id: _id.toString(),
      uuid,
      message,
      room_id: room_id.toString(),
      user_id: user_id.toString(),
      created_at,
    };
  }

  async getPrivateRoom(
    param: PrivateRoomQueryDto,
  ): Promise<RoomWebDto | undefined> {
    const room: RoomDocument = await this.roomModel.findOne({
      user_ids: { $all: param.userIds },
      type: 'private',
    });

    return room ? this.getWebRoomDto(room) : room;
  }

  async createPrivateRoom(
    param: PrivateRoomQueryDto,
  ): Promise<RoomWebDto | undefined> {
    const room: RoomDocument = await this.roomModel.create({
      type: 'private',
      created_at: new Date(),
      user_ids: param.userIds,
    });
    await room.save();

    return this.getWebRoomDto(room);
  }

  async getUserRoom(param: UserRoomQueryDto): Promise<RoomWebDto | undefined> {
    const { id, user_id } = param;
    const room: RoomDocument = await this.roomModel.findOne({
      id,
      user_ids: user_id,
    });

    return room ? this.getWebRoomDto(room) : room;
  }

  async saveMessage(param: MessageWebDto): Promise<MessageWebDto | undefined> {
    const { uuid, message, room_id, user_id, created_at } = param;
    const newMessage: MessageDocument = new this.messageModel({
      uuid,
      message,
      room_id,
      user_id,
      created_at,
    });
    await newMessage.save();

    return this.getWebMessageDto(newMessage);
  }

  async getRoomMessages(param: {
    roomId: string;
  }): Promise<MessageWebDto[] | undefined> {
    const messages: MessageWebDto[] = await this.messageModel
      .find({ room_id: param.roomId })
      .sort({ _id: -1 })
      .limit(100);

    return messages?.length
      ? messages.map((message: MessageDocument) =>
          this.getWebMessageDto(message),
        )
      : [];
  }

  async saveAnalysis(param: { id: string; analysis: messageAnalysisDto }) {
    const { id, analysis } = param;

    const message = await this.messageModel.findById(id);
    if (!message) {
      return;
    }
    message.analysis = {
      ...(message.analysis || {}),
      ...analysis,
    };
    await message.save();
  }
}
