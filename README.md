
## Microservices for beginners. Message service. Nest js. Mongodb. Kafka.

Message service provides functionality for messages in application, this service contains all messages and chat rooms. I use Nest.js for backend, Mongo database and Kafka as message broker.

Full code - [link](https://github.com/Igorok/micro-message)

### Whole scheme:

![Containers](./docs/img/messages-containers.png)

Short description:

- User opens front-end application in web browser and joins chat room, front-end emits an event to the api gateway by socket.io.
- Api gateway gets chat data from the message service by http request and emits this to the front-end.
- For the messaging, front end service communicates with api gateway by socket.io.
- Api gateway implements publish-subscribe pattern to emit raw message events for listeners, through kafka message broker.
- Message service receives raw message events, saves messages and emits events with saved messages.
- Api gateway receives saved messages and emits this to the front-end application.
- Also message service subscribes to analysis events from spam and toxic services, and saves analises for the messages.

### Scheme of message service:

![Code](./docs/img/messages-code.png)

`main.ts` - initialization of service. I use `swagger` as documentation and REST client for testing of http requests.

```typescript
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as basicAuth from 'express-basic-auth';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService: ConfigService = app.get(ConfigService);

  app.use(
    ['/swagger'],
    basicAuth({
      challenge: true,
      users: {
        [configService.get<string>('DOC_USER')]:
          configService.get<string>('DOC_PASS'),
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Message Service')
    .setDescription('Message Service API description')
    .setVersion('0.0.1')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('swagger', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(configService.get<string>('APP_PORT'));
}

bootstrap();
```

`app.module.ts` - describes modules in service:

- ConfigModule - provides configuration functionality
- MongooseModule - provides Mongoose ODM functionality
- MessagesRepoModule - provides communication with database through Mongoose ODM
- MessagesModule - implements application and domain logics of service

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { MessagesModule } from './modules/messages/messages.module';
import { MessagesRepoModule } from './modules/messages-repo/messages.repo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [
        __dirname + '/../config/.env.prod',
        __dirname + '/../config/.env.dev',
      ],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return { uri: configService.get<string>('MONGO_URI') };
      },
    }),
    MessagesRepoModule,
    MessagesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule {}
```

### Messages module

`messages.module.ts` - describes messages module
```typescript
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

```

`messages.controller.ts` - provides http requests to receive data about chat rooms
```typescript
import { Controller, Get, UsePipes, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrivateRoomQueryDto, RoomDataDto } from 'micro-dto';
import { JoiValidationPipe } from 'src/pipes/joi.validation.pipe';
import { MessagesService } from './messages.service';
import { privateRoomQueryJoi } from './messages.joi';

@Controller('messages')
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Get('/get-private-room')
  @ApiOperation({ summary: 'Get user by id' })
  @ApiTags('Users')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Success',
    type: RoomDataDto,
  })
  @UsePipes(new JoiValidationPipe(privateRoomQueryJoi))
  getPrivateRoom(@Query() params: PrivateRoomQueryDto): Promise<RoomDataDto> {
    return this.messagesService.getPrivateRoom(params);
  }
}
```

`messages.joi.ts` - provides validation for messages.controller api
```typescript
import * as Joi from 'joi';

export const privateRoomQueryJoi = Joi.object({
  userIds: Joi.array().length(2).items(Joi.string().length(24)),
});
```

`kafka.controller.ts` - provides publish-subscribe functionality for communication with other services
```typescript
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
```

`messages.service.ts` - provides application and domain logic
```typescript
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
```

### Messages repo module

`messages.repo.module.ts` - describes module
```typescript
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
```

`messages.schema.ts` - contains Mongoose schema for messages collection in Mongo database.
```typescript
import { HydratedDocument } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { messageAnalysisDto } from 'micro-dto';

export type MessageDocument = HydratedDocument<Message>;

@Schema()
export class Message {
  @Prop({ type: String })
  uuid: string;

  @Prop({ type: String })
  message: string;

  @Prop({ type: String })
  room_id: string;

  @Prop({ type: String })
  user_id: string;

  @Prop({ type: Date })
  created_at: Date;

  @Prop({ type: Object })
  analysis?: messageAnalysisDto;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
```

`rooms.schema.ts` - contains Mongoose schema for chat rooms collection in Mongo database.
```typescript
import { HydratedDocument } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type RoomDocument = HydratedDocument<Room>;

@Schema()
export class Room {
  @Prop({ type: String })
  type: string;

  @Prop({ type: Array })
  user_ids: string[];

  @Prop({ type: Date })
  created_at: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
```

`messages.repo.service.ts` - contains database requests for messages module
```typescript
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
```

### Additionally:

How to install Mongo from docker:

Download docker container, launch with required properties, and open console:
```
docker pull mongo
docker run -d --name micro-mongo -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=micro_user -e MONGO_INITDB_ROOT_PASSWORD=micro_pwd mongo
docker exec -it micro-mongo mongosh
```

Settings for database and text index:
```
use admin
db.auth('micro_user', 'micro_pwd')

use micro_messages
db.createUser(
  {
    user: 'micro_user',
    pwd: 'micro_pwd',
    roles: [
       { db: 'micro_messages', role: 'dbAdmin', },
       { db: 'micro_messages', role: 'readWrite', }
    ]
  }
);
db.users.createIndex({ login: 'text' });
```

How to install Kafka from docker:

Download docker-compose from github - https://github.com/tchiotludo/akhq.
Launch docker-compose:
```
docker-compose pull
docker-compose up -d
```


### Create project

```
nest new message-service
```

Install configuration

```
npm i --save @nestjs/config
```

Configuration for serivce `config/.env.dev`

```
APP_PORT=3003
APP_ENV=DEV
DOC_USER=usr
DOC_PASS=pass
MONGO_URI=mongodb://micro_user:micro_pwd@localhost:27017/micro_messages
KAFKA_URI=localhost:9094
```

Generate `src/modules/messages` module

```
nest generate module messages
nest generate service messages
nest generate controller messages
```

Generate `src/modules/messages-repo` module

```
nest generate module messages-repo
nest generate service messages-repo
nest generate controller messages-repo
```

Install Joi

```
npm install --save joi
```

Install Swagger

```
npm install --save @nestjs/swagger swagger-ui-express
npm install --save express-basic-auth
```

### Git
```
cd /
git init
git remote add origin git@bitbucket.org:idubininteam/message-service.git
git pull
git checkout master -f
git branch --set-upstream-to origin/master
git pull origin master --allow-unrelated-histories
```

### Common dto
https://bitbucket.org/idubininteam/micro-dto/src/master/
```
npm install bitbucket:idubininteam/micro-dto.git#master --save
```


### Docker compose
Remove containers
Stop the container(s) using the following command:
```
docker-compose down
```
Delete all containers using the following command:
```
docker rm -f $(docker ps -a -q)
```
Delete all volumes using the following command:
```
docker volume rm $(docker volume ls -q)
```
Restart the containers using the following command:
```
docker-compose up -d
```
