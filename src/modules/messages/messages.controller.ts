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
