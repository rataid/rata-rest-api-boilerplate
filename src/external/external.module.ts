import { Module } from '@nestjs/common';
import { SsoTalentaModule } from './sso-talenta/sso-talenta.module';

@Module({
  imports: [SsoTalentaModule],
  exports: [SsoTalentaModule],
})
export class ExternalModule {}
