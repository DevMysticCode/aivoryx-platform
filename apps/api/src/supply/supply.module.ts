import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { LogisticsController } from './logistics.controller.js';
import { LogisticsService } from './logistics.service.js';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Procurement, inventory & logistics (Phase 5, ADR 0034) — the operational
 * supply-chain layer. Imports `AdminModule` for the shared transactional
 * outbox and `StorageModule` for delivery attachments; every stock change
 * flows through the `applyStockMovement` primitive in `inventory-core.ts`.
 */
@Module({
  imports: [AdminModule, StorageModule],
  controllers: [
    ProjectsController,
    CatalogController,
    InventoryController,
    ProcurementController,
    LogisticsController,
  ],
  providers: [
    ProjectsService,
    CatalogService,
    InventoryService,
    ProcurementService,
    LogisticsService,
  ],
  exports: [ProjectsService],
})
export class SupplyModule {}
