import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '', 10) || 3000,
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const ssoTalentaConfig = registerAs('ssoTalenta', () => ({
  baseUrl: process.env.SSO_TALENTA_BASE_URL,
  apiKey: process.env.SSO_TALENTA_API_KEY,
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT ?? '', 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
}));

export const mailConfig = registerAs('mail', () => ({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT ?? '', 10) || 587,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.SMTP_FROM,
}));
