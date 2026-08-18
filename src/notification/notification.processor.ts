import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { NOTIFICATION_QUEUE, SEND_NOTIFICATION_JOB } from './notification.constants';
import { NotificationChannelType, SendNotificationJob } from './dto/send-notification.dto';
import { EmailChannel } from './channels/email.channel';
import { TemplateService } from './template.service';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly emailChannel: EmailChannel,
    private readonly templateService: TemplateService,
  ) {}

  @Process(SEND_NOTIFICATION_JOB)
  async handleSendNotification(job: Job<SendNotificationJob>): Promise<void> {
    const { channel, to, subject, template, context } = job.data;
    const body = this.templateService.render(template, context);

    switch (channel) {
      case NotificationChannelType.EMAIL:
        await this.emailChannel.send({ to, subject, body });
        break;
      default:
        this.logger.warn(`Unknown notification channel: ${channel}`);
    }
  }
}
