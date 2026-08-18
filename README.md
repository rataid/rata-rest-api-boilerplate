# NestJS REST API Boilerplate (Prisma)

Combined boilerplate: notiz-dev structure + 7codeRO auth/CI + raminious REST simplicity.

## Stack

- NestJS 10 + Express
- Prisma + PostgreSQL
- JWT auth (Passport)
- Role-based guards
- Swagger docs (`/docs`)
- Global exception filter + logging interceptor
- Rate limiting (Throttler)
- Docker + docker-compose
- GitHub Actions CI

## Setup

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

Swagger: `http://localhost:3000/docs`

## Structure

```
src/
  auth/         JWT auth, guards, strategies
  users/        example domain module
  prisma/       PrismaService (global)
  common/       filters, interceptors, guards, decorators
prisma/
  schema.prisma
  seed.ts
```

## Seed user

- email: `admin@example.com`
- password: `admin123`

## Adding a new domain module

```bash
nest g module products
nest g controller products
nest g service products
```

Follow `users/` pattern: DTO with `class-validator`, guard with `@Roles()`, response DTO to strip sensitive fields.
