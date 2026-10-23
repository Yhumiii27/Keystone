ALTER TABLE "itp_plans" DROP CONSTRAINT "itp_plans_project_id_unique";--> statement-breakpoint
ALTER TABLE "commissioning_systems" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "itp_plans" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "punch_items" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "commissioning_systems" ADD CONSTRAINT "commissioning_systems_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_plans" ADD CONSTRAINT "itp_plans_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itp_plans_project_without_equipment_idx" ON "itp_plans" USING btree ("project_id") WHERE "itp_plans"."equipment_id" is null;--> statement-breakpoint
CREATE INDEX "itp_plans_project_id_idx" ON "itp_plans" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "itp_plans" ADD CONSTRAINT "itp_plans_equipment_id_unique" UNIQUE("equipment_id");