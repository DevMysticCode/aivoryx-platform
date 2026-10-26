import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
