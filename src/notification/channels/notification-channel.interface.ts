export interface NotificationPayload {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationChannel {
  send(payload: NotificationPayload): Promise<void>;
}
