import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  base: { instance: config.INSTANCE_ID },
  redact: ['req.headers.authorization', 'password'],
});
