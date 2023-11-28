import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { KafkaController } from './kafka.controller';
import { MessagesRepoModule } from 'src/modules/messages-repo/messages.repo.module';

@Module({
  providers: [MessagesService],
  controllers: [MessagesController, KafkaController],
  imports: [MessagesRepoModule],
  exports: [MessagesService],
})
export class MessagesModule {}
