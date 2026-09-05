CREATE TYPE "public"."dispatch_status" AS ENUM('DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."project_activity_type" AS ENUM('created', 'approved', 'status_changed', 'on_hold', 'resumed', 'cancelled', 'material_added', 'material_updated', 'material_removed', 'allocated', 'released', 'purchase_order_linked', 'goods_received', 'dispatch_created', 'dispatched', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('DRAFT', 'APPROVED', 'PROCUREMENT', 'READY_FOR_DISPATCH', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('RECEIPT', 'ALLOCATION', 'RELEASE', 'DISPATCH', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('main', 'regional', 'transit', 'site');--> statement-breakpoint
CREATE TABLE "dispatch_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_attachments_object_key_uq" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "dispatch_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"project_material_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"delivered_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_lines_dispatch_line_uq" UNIQUE("tenant_id","dispatch_id","line_no"),
	CONSTRAINT "dispatch_lines_qty_valid" CHECK ("quantity" > 0 and "delivered_qty" >= 0 and "delivered_qty" <= "quantity")
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "dispatch_status" DEFAULT 'DRAFT' NOT NULL,
	"destination_address" text,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"notes" text,
	"delivery_notes" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatches_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "dispatches_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"received_qty" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_lines_qty_pos" CHECK ("received_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"idempotency_key" text,
	"received_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "goods_receipts_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "goods_receipts_tenant_idempotency_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "product_categories_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"unit_id" uuid NOT NULL,
	"brand" text,
	"model" text,
	"reorder_level" numeric(18, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_sku_uq" UNIQUE("tenant_id","sku"),
	CONSTRAINT "products_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "project_activity_type" NOT NULL,
	"actor_membership_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"required_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"allocated_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"dispatched_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"delivered_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_materials_tenant_project_product_uq" UNIQUE("tenant_id","project_id","product_id"),
	CONSTRAINT "project_materials_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "project_materials_qty_nonneg" CHECK (
      "required_qty" >= 0 and "allocated_qty" >= 0
      and "dispatched_qty" >= 0 and "delivered_qty" >= 0
    )
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_name" text,
	"status" "project_status" DEFAULT 'DRAFT' NOT NULL,
	"site_address_line" text,
	"site_city" text,
	"site_state" text,
	"site_postal_code" text,
	"site_country" text,
	"approved_at" timestamp with time zone,
	"approved_by_membership_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "projects_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"ordered_qty" numeric(18, 4) NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_po_line_uq" UNIQUE("tenant_id","purchase_order_id","line_no"),
	CONSTRAINT "purchase_order_lines_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "purchase_order_lines_qty_valid" CHECK ("ordered_qty" > 0 and "received_qty" >= 0 and "received_qty" <= "ordered_qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"project_id" uuid,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"order_date" timestamp with time zone,
	"expected_date" timestamp with time zone,
	"notes" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_membership_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "purchase_orders_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"on_hand" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_tenant_wh_product_uq" UNIQUE("tenant_id","warehouse_id","product_id"),
	CONSTRAINT "stock_levels_nonneg" CHECK ("on_hand" >= 0 and "reserved" >= 0 and "reserved" <= "on_hand")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"on_hand_delta" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved_delta" numeric(18, 4) DEFAULT '0' NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"project_id" uuid,
	"reference_type" text,
	"reference_id" uuid,
	"idempotency_key" text,
	"notes" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"tax_reference" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "suppliers_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "units_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "warehouse_type" DEFAULT 'main' NOT NULL,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "warehouses_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_dispatch_fk" FOREIGN KEY ("dispatch_id","tenant_id") REFERENCES "public"."dispatches"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_uploaded_by_fk" FOREIGN KEY ("uploaded_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_dispatch_fk" FOREIGN KEY ("dispatch_id","tenant_id") REFERENCES "public"."dispatches"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_project_material_fk" FOREIGN KEY ("project_material_id","tenant_id") REFERENCES "public"."project_materials"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_warehouse_fk" FOREIGN KEY ("warehouse_id","tenant_id") REFERENCES "public"."warehouses"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_gr_fk" FOREIGN KEY ("goods_receipt_id","tenant_id") REFERENCES "public"."goods_receipts"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_pol_fk" FOREIGN KEY ("purchase_order_line_id","tenant_id") REFERENCES "public"."purchase_order_lines"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_fk" FOREIGN KEY ("purchase_order_id","tenant_id") REFERENCES "public"."purchase_orders"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_fk" FOREIGN KEY ("warehouse_id","tenant_id") REFERENCES "public"."warehouses"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_fk" FOREIGN KEY ("received_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("category_id","tenant_id") REFERENCES "public"."product_categories"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_fk" FOREIGN KEY ("unit_id","tenant_id") REFERENCES "public"."units"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_actor_fk" FOREIGN KEY ("actor_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_materials" ADD CONSTRAINT "project_materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_materials" ADD CONSTRAINT "project_materials_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_materials" ADD CONSTRAINT "project_materials_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_approved_by_fk" FOREIGN KEY ("approved_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_fk" FOREIGN KEY ("purchase_order_id","tenant_id") REFERENCES "public"."purchase_orders"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("supplier_id","tenant_id") REFERENCES "public"."suppliers"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fk" FOREIGN KEY ("approved_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_fk" FOREIGN KEY ("warehouse_id","tenant_id") REFERENCES "public"."warehouses"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_fk" FOREIGN KEY ("warehouse_id","tenant_id") REFERENCES "public"."warehouses"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_attachments_tenant_dispatch_idx" ON "dispatch_attachments" USING btree ("tenant_id","dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatch_lines_tenant_dispatch_idx" ON "dispatch_lines" USING btree ("tenant_id","dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatches_tenant_status_idx" ON "dispatches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "dispatches_tenant_project_idx" ON "dispatches" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "dispatches_tenant_warehouse_idx" ON "dispatches" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "dispatches_tenant_dispatched_idx" ON "dispatches" USING btree ("tenant_id","dispatched_at");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_tenant_gr_idx" ON "goods_receipt_lines" USING btree ("tenant_id","goods_receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_po_idx" ON "goods_receipts" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "products_tenant_category_idx" ON "products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "products_tenant_active_idx" ON "products" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "project_activities_tenant_project_idx" ON "project_activities" USING btree ("tenant_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_materials_tenant_project_idx" ON "project_materials" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "projects_tenant_status_idx" ON "projects" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "projects_tenant_lead_idx" ON "projects" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_po_idx" ON "purchase_order_lines" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_status_idx" ON "purchase_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_project_idx" ON "purchase_orders" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_order_date_idx" ON "purchase_orders" USING btree ("tenant_id","order_date");--> statement-breakpoint
CREATE INDEX "stock_levels_tenant_product_idx" ON "stock_levels" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_wh_product_idx" ON "stock_movements" USING btree ("tenant_id","warehouse_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_project_idx" ON "stock_movements" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_created_idx" ON "stock_movements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_idempotency_uq" ON "stock_movements" USING btree ("tenant_id","idempotency_key") WHERE "stock_movements"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "suppliers_tenant_active_idx" ON "suppliers" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "warehouses_tenant_active_idx" ON "warehouses" USING btree ("tenant_id","is_active");
--> statement-breakpoint

-- Row Level Security for the Phase 5 procurement/inventory/logistics tables
-- (ADR 0034). Hand-appended: drizzle-kit does not model RLS, so the paired
-- meta/0007_snapshot.json stays in sync and `db:generate` reports no drift.

GRANT SELECT, INSERT, UPDATE, DELETE ON "units" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "units_tenant_isolation" ON "units";--> statement-breakpoint
CREATE POLICY "units_tenant_isolation" ON "units"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "product_categories" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "product_categories_tenant_isolation" ON "product_categories";--> statement-breakpoint
CREATE POLICY "product_categories_tenant_isolation" ON "product_categories"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "products_tenant_isolation" ON "products";--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "suppliers" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "suppliers_tenant_isolation" ON "suppliers";--> statement-breakpoint
CREATE POLICY "suppliers_tenant_isolation" ON "suppliers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "warehouses" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "warehouses_tenant_isolation" ON "warehouses";--> statement-breakpoint
CREATE POLICY "warehouses_tenant_isolation" ON "warehouses"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "projects_tenant_isolation" ON "projects";--> statement-breakpoint
CREATE POLICY "projects_tenant_isolation" ON "projects"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_activities" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_activities_tenant_isolation" ON "project_activities";--> statement-breakpoint
CREATE POLICY "project_activities_tenant_isolation" ON "project_activities"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_materials" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_materials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_materials_tenant_isolation" ON "project_materials";--> statement-breakpoint
CREATE POLICY "project_materials_tenant_isolation" ON "project_materials"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_levels" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "stock_levels_tenant_isolation" ON "stock_levels";--> statement-breakpoint
CREATE POLICY "stock_levels_tenant_isolation" ON "stock_levels"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_movements" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "stock_movements_tenant_isolation" ON "stock_movements";--> statement-breakpoint
CREATE POLICY "stock_movements_tenant_isolation" ON "stock_movements"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "purchase_orders_tenant_isolation" ON "purchase_orders";--> statement-breakpoint
CREATE POLICY "purchase_orders_tenant_isolation" ON "purchase_orders"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_order_lines" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "purchase_order_lines_tenant_isolation" ON "purchase_order_lines";--> statement-breakpoint
CREATE POLICY "purchase_order_lines_tenant_isolation" ON "purchase_order_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipts" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "goods_receipts_tenant_isolation" ON "goods_receipts";--> statement-breakpoint
CREATE POLICY "goods_receipts_tenant_isolation" ON "goods_receipts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "goods_receipt_lines" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "goods_receipt_lines_tenant_isolation" ON "goods_receipt_lines";--> statement-breakpoint
CREATE POLICY "goods_receipt_lines_tenant_isolation" ON "goods_receipt_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "dispatches" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "dispatches_tenant_isolation" ON "dispatches";--> statement-breakpoint
CREATE POLICY "dispatches_tenant_isolation" ON "dispatches"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "dispatch_lines" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "dispatch_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dispatch_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "dispatch_lines_tenant_isolation" ON "dispatch_lines";--> statement-breakpoint
CREATE POLICY "dispatch_lines_tenant_isolation" ON "dispatch_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "dispatch_attachments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "dispatch_attachments_tenant_isolation" ON "dispatch_attachments";--> statement-breakpoint
CREATE POLICY "dispatch_attachments_tenant_isolation" ON "dispatch_attachments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
