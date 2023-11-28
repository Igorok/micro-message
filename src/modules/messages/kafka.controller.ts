import { Kafka, Producer, Consumer, KafkaMessage } from 'kafkajs';
import { ConfigService } from '@nestjs/config';
import {
  Controller,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessageWebDto, messageAnalysisDto } from 'micro-dto';

@Controller()
export class KafkaController implements OnModuleInit, OnModuleDestroy {
  constructor(
    private configService: ConfigService,
    private messagesService: MessagesService,
  ) {}

  private readonly logger = new Logger(KafkaController.name);

  private readonly kafka: Kafka = new Kafka({
    clientId: 'messages',
    brokers: [this.configService.get<string>('KAFKA_URI')],
  });

  private readonly producer: Producer = this.kafka.producer();
  private readonly consumer: Consumer = this.kafka.consumer({
    groupId: this.configService.get<string>('KAFKA_RAW_MESSAGE_GROUP'),
  });
  private readonly analysisConsumer: Consumer = this.kafka.consumer({
    groupId: this.configService.get<string>('KAFKA_ANALYSIS_MESSAGE_GROUP'),
  });

  async onModuleInit() {
    try {
      await this.producer.connect();

      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: this.configService.get<string>('KAFKA_RAW_MESSAGE_TOPIC'),
        fromBeginning: true,
      });
      await this.analysisConsumer.subscribe({
        topic: this.configService.get<string>('KAFKA_ANALYSIS_MESSAGE_TOPIC'),
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          this.receiveMessage(message);
        },
      });
      await this.analysisConsumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          this.receiveAnalysis(message);
        },
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  async onModuleDestroy() {
    try {
      await this.producer.disconnect();
      await this.consumer.disconnect();
      await this.analysisConsumer.disconnect();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async receiveMessage(params: KafkaMessage) {
    try {
      const messageValue = JSON.parse(params.value.toString());
      const { uuid, message, room_id, user_id, created_at } = messageValue;
      const readyMessage: MessageWebDto =
        await this.messagesService.receiveMessage({
          uuid,
          message,
          room_id,
          user_id,
          created_at,
        });

      await this.producer.send({
        topic: this.configService.get<string>('KAFKA_READY_MESSAGE_TOPIC'),
        messages: [
          {
            key: room_id,
            value: JSON.stringify(readyMessage),
          },
        ],
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  async receiveAnalysis(params: KafkaMessage) {
    try {
      const messageValue: { id: string; analysis: messageAnalysisDto } =
        JSON.parse(params.value.toString());
      const { id, analysis } = messageValue;
      await this.messagesService.receiveAnalysis({ id, analysis });
    } catch (error) {
      this.logger.error(error);
    }
  }
}
