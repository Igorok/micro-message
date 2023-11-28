import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessagesRepoService } from './messages.repo.service';
import { Message, MessageSchema } from './messages.schema';
import { Room, RoomSchema } from './rooms.schema';

@Module({
  providers: [MessagesRepoService],
  exports: [MessagesRepoService],
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
})
export class MessagesRepoModule {}
