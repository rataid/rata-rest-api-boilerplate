import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SsoTalentaService } from './sso-talenta.service';

@Module({
  imports: [HttpModule],
  providers: [SsoTalentaService],
  exports: [SsoTalentaService],
})
export class SsoTalentaModule {}
