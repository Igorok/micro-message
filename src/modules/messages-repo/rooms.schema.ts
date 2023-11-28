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
