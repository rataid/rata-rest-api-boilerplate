import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { NOTIFICATION_QUEUE, SEND_NOTIFICATION_JOB } from './notification.constants';
import {
  NotificationChannelType,
  SendNotificationJob,
} from './dto/send-notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue<SendNotificationJob>,
  ) {}

  async sendEmail(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    await this.queue.add(
      SEND_NOTIFICATION_JOB,
      { channel: NotificationChannelType.EMAIL, to, subject, template, context },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
