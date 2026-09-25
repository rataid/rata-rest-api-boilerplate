# NestJS REST API Boilerplate (Prisma)


## Stack

- NestJS 10 
- Prisma + PostgreSQL
- JWT auth (Passport)
- Role-based guards
- Swagger docs (`/docs`)
- Global exception filter + logging interceptor
- Rate limiting (Throttler)
- GitHub Actions CI

## Setup

```bash
cp .env.example .env
pnpm install
npx prisma migrate dev
npx run prisma:seed
npx run start:dev
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
scripts/
  provision-cro-accounts.js   one-off inject akun CRO ticketing
  move-klinik-tickets.js      pindah tiket team Klinik ke team klinik
```

Cara menjalankan kedua script ada di `scripts/README.md`.

## Seed user

- email: `admin@example.com`
- password: `admin123`

## Adding a new domain module

```bash
pnpm exec nest g resource products --type rest --no-spec
```

