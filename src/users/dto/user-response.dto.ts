import { Exclude } from 'class-transformer';
import { Role } from '@prisma/client';

export class UserResponseDto {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  createdAt: Date;

  @Exclude()
  password: string;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
