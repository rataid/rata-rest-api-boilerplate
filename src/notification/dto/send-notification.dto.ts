export enum NotificationChannelType {
  EMAIL = 'email',
}

export interface SendNotificationJob {
  channel: NotificationChannelType;
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
}
