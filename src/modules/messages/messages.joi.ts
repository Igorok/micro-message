import * as Joi from 'joi';

export const privateRoomQueryJoi = Joi.object({
  userIds: Joi.array().length(2).items(Joi.string().length(24)),
});
