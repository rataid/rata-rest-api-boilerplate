import { IsEmail, IsNotEmpty } from 'class-validator';

export class SsoTalentaLookupDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export interface SsoTalentaUserResponse {
  id: string;
  email: string;
  name: string;
  employeeId: string;
  isActive: boolean;
}
