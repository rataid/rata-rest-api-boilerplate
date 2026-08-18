import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { NOTIFICATION_QUEUE } from './notification.constants';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { EmailChannel } from './channels/email.channel';
import { TemplateService } from './template.service';

@Module({
  imports: [
    // Redis connection is shared from BullModule.forRootAsync() in AppModule.
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  providers: [NotificationService, NotificationProcessor, EmailChannel, TemplateService],
  exports: [NotificationService],
})
export class NotificationModule {}
