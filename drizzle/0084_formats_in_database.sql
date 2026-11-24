ALTER TABLE "cities" ADD CONSTRAINT "cities_name_filled" CHECK (length(btrim("cities"."name")) > 0);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_name_filled" CHECK (length(btrim("clients"."name")) > 0);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_code3_shape" CHECK ("clients"."code3" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_name_filled" CHECK (length(btrim("countries"."name")) > 0);--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_name_filled" CHECK (length(btrim("departments"."name")) > 0);--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_short_name_filled" CHECK (length(btrim("persons"."short_name")) > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_title_filled" CHECK (length(btrim("users"."title")) > 0);--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_code_domain" CHECK ("zones"."code" in ('euna', 'afr', 'apac'));--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_label_filled" CHECK (length(btrim("zones"."label")) > 0);--> statement-breakpoint
ALTER TABLE "lifecycle_stages" ADD CONSTRAINT "lifecycle_stages_code_domain" CHECK ("lifecycle_stages"."code" in ('initiative', 'aps', 'apd', 'etudes', 'approvisionnements', 'fabrication_assemblage', 'fat', 'expedition', 'chantier', 'mise_en_service_sat', 'garantie', 'clos', 'annule'));--> statement-breakpoint
ALTER TABLE "lifecycle_stages" ADD CONSTRAINT "lifecycle_stages_label_filled" CHECK (length(btrim("lifecycle_stages"."label")) > 0);--> statement-breakpoint
ALTER TABLE "lifecycle_stages" ADD CONSTRAINT "lifecycle_stages_short_label_filled" CHECK (length(btrim("lifecycle_stages"."short_label")) > 0);--> statement-breakpoint
ALTER TABLE "lifecycle_stages" ADD CONSTRAINT "lifecycle_stages_stage_group_domain" CHECK ("lifecycle_stages"."stage_group" in ('pipeline', 'execution', 'warranty', 'terminal'));--> statement-breakpoint
ALTER TABLE "machine_catalogue_entries" ADD CONSTRAINT "machine_catalogue_entries_label_filled" CHECK (length(btrim("machine_catalogue_entries"."label")) > 0);--> statement-breakpoint
ALTER TABLE "machine_type_cost_categories" ADD CONSTRAINT "machine_type_cost_categories_name_filled" CHECK (length(btrim("machine_type_cost_categories"."name")) > 0);--> statement-breakpoint
ALTER TABLE "machine_type_cost_categories" ADD CONSTRAINT "machine_type_cost_categories_cost_type_domain" CHECK ("machine_type_cost_categories"."cost_type" in ('labor', 'material', 'equipment', 'subcontract', 'fees', 'reserve'));--> statement-breakpoint
ALTER TABLE "machine_type_itp_systems" ADD CONSTRAINT "machine_type_itp_systems_name_filled" CHECK (length(btrim("machine_type_itp_systems"."name")) > 0);--> statement-breakpoint
ALTER TABLE "machine_type_phases" ADD CONSTRAINT "machine_type_phases_name_filled" CHECK (length(btrim("machine_type_phases"."name")) > 0);--> statement-breakpoint
ALTER TABLE "machine_types" ADD CONSTRAINT "machine_types_label_filled" CHECK (length(btrim("machine_types"."label")) > 0);--> statement-breakpoint
ALTER TABLE "machine_types" ADD CONSTRAINT "machine_types_deposit_pct_range" CHECK ("machine_types"."deposit_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "machine_types" ADD CONSTRAINT "machine_types_delivery_pct_range" CHECK ("machine_types"."delivery_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "machine_types" ADD CONSTRAINT "machine_types_acceptance_pct_range" CHECK ("machine_types"."acceptance_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "project_template_cost_categories" ADD CONSTRAINT "project_template_cost_categories_name_filled" CHECK (length(btrim("project_template_cost_categories"."name")) > 0);--> statement-breakpoint
ALTER TABLE "project_template_cost_categories" ADD CONSTRAINT "project_template_cost_categories_cost_type_domain" CHECK ("project_template_cost_categories"."cost_type" in ('labor', 'material', 'equipment', 'subcontract', 'fees', 'reserve'));--> statement-breakpoint
ALTER TABLE "project_template_phases" ADD CONSTRAINT "project_template_phases_name_filled" CHECK (length(btrim("project_template_phases"."name")) > 0);--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_code_filled" CHECK (length(btrim("project_templates"."code")) > 0);--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_name_filled" CHECK (length(btrim("project_templates"."name")) > 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_shape" CHECK ("projects"."code" ~ '^[A-Z]{3}-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_number_shape" CHECK ("projects"."number" ~ '^#[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_short_code_shape" CHECK ("projects"."short_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_name_filled" CHECK (length(btrim("projects"."name")) > 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_analytic_code_shape" CHECK ("projects"."analytic_code" ~ '^[A-Z]{3}[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_progress_range" CHECK ("projects"."progress" between 0 and 1);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_currency_shape" CHECK ("projects"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contingency_pct_range" CHECK ("projects"."contingency_pct" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_planned_finish_date_order" CHECK ("projects"."planned_finish_date" >= "projects"."planned_start_date");--> statement-breakpoint
ALTER TABLE "stage_deliverable_defs" ADD CONSTRAINT "stage_deliverable_defs_label_filled" CHECK (length(btrim("stage_deliverable_defs"."label")) > 0);--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_mode_domain" CHECK ("stage_transitions"."mode" in ('auto', 'forced', 'revert'));--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_validation_status_domain" CHECK ("stage_transitions"."validation_status" in ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_code_filled" CHECK (length(btrim("activities"."code")) > 0);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_name_filled" CHECK (length(btrim("activities"."name")) > 0);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_duration_days_range" CHECK ("activities"."duration_days" >= 0);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_percent_complete_range" CHECK ("activities"."percent_complete" between 0 and 100);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_finish_date_order" CHECK ("activities"."finish_date" >= "activities"."start_date");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_early_finish_date_order" CHECK ("activities"."early_finish_date" >= "activities"."early_start_date");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_late_finish_date_order" CHECK ("activities"."late_finish_date" >= "activities"."late_start_date");--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_planned_hours_range" CHECK ("activity_assignments"."planned_hours" >= 0);--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_actual_hours_range" CHECK ("activity_assignments"."actual_hours" >= 0);--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_resource_count_range" CHECK ("activity_assignments"."resource_count" >= 0);--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_type_domain" CHECK ("activity_links"."type" in ('FS', 'SS', 'FF', 'SF'));--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_name_filled" CHECK (length(btrim("milestones"."name")) > 0);--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_status_domain" CHECK ("milestones"."status" in ('done', 'late', 'at_risk', 'on_track'));--> statement-breakpoint
ALTER TABLE "pipeline_stage_plans" ADD CONSTRAINT "pipeline_stage_plans_window_domain" CHECK ("pipeline_stage_plans"."window" in ('initiative', 'aps', 'apd', 'board'));--> statement-breakpoint
ALTER TABLE "plan_trash" ADD CONSTRAINT "plan_trash_kind_domain" CHECK ("plan_trash"."kind" in ('wp', 'act'));--> statement-breakpoint
ALTER TABLE "plan_trash" ADD CONSTRAINT "plan_trash_code_filled" CHECK (length(btrim("plan_trash"."code")) > 0);--> statement-breakpoint
ALTER TABLE "plan_trash" ADD CONSTRAINT "plan_trash_name_filled" CHECK (length(btrim("plan_trash"."name")) > 0);--> statement-breakpoint
ALTER TABLE "schedule_bars" ADD CONSTRAINT "schedule_bars_name_filled" CHECK (length(btrim("schedule_bars"."name")) > 0);--> statement-breakpoint
ALTER TABLE "schedule_bars" ADD CONSTRAINT "schedule_bars_percent_complete_range" CHECK ("schedule_bars"."percent_complete" between 0 and 100);--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_code_filled" CHECK (length(btrim("wbs_nodes"."code")) > 0);--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_name_filled" CHECK (length(btrim("wbs_nodes"."name")) > 0);--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_finish_date_order" CHECK ("wbs_nodes"."finish_date" >= "wbs_nodes"."start_date");--> statement-breakpoint
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_code_filled" CHECK (length(btrim("cost_categories"."code")) > 0);--> statement-breakpoint
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_name_filled" CHECK (length(btrim("cost_categories"."name")) > 0);--> statement-breakpoint
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_cost_type_domain" CHECK ("cost_categories"."cost_type" in ('labor', 'material', 'equipment', 'subcontract', 'fees', 'reserve'));--> statement-breakpoint
ALTER TABLE "cost_streams" ADD CONSTRAINT "cost_streams_name_filled" CHECK (length(btrim("cost_streams"."name")) > 0);--> statement-breakpoint
ALTER TABLE "offer_quotes" ADD CONSTRAINT "offer_quotes_deposit_pct_range" CHECK ("offer_quotes"."deposit_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "offer_quotes" ADD CONSTRAINT "offer_quotes_delivery_pct_range" CHECK ("offer_quotes"."delivery_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "offer_quotes" ADD CONSTRAINT "offer_quotes_acceptance_pct_range" CHECK ("offer_quotes"."acceptance_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "wp_budgets" ADD CONSTRAINT "wp_budgets_name_filled" CHECK (length(btrim("wp_budgets"."name")) > 0);--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_name_filled" CHECK (length(btrim("baseline_activities"."name")) > 0);--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_duration_days_range" CHECK ("baseline_activities"."duration_days" >= 0);--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_percent_complete_range" CHECK ("baseline_activities"."percent_complete" between 0 and 100);--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_finish_date_order" CHECK ("baseline_activities"."finish_date" >= "baseline_activities"."start_date");--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_code_shape" CHECK ("baselines"."code" ~ '^BL[0-9]+$');--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_name_filled" CHECK (length(btrim("baselines"."name")) > 0);--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_state_domain" CHECK ("baselines"."state" in ('rejected', 'superseded', 'current', 'proposed'));--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_source_domain" CHECK ("baselines"."source" in ('seed', 'snapshot', 'change_request', 'import'));--> statement-breakpoint
ALTER TABLE "budget_change_lines" ADD CONSTRAINT "budget_change_lines_number_shape" CHECK ("budget_change_lines"."number" ~ '^CR-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "budget_change_lines" ADD CONSTRAINT "budget_change_lines_title_filled" CHECK (length(btrim("budget_change_lines"."title")) > 0);--> statement-breakpoint
ALTER TABLE "budget_change_lines" ADD CONSTRAINT "budget_change_lines_status_domain" CHECK ("budget_change_lines"."status" in ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "change_request_steps" ADD CONSTRAINT "change_request_steps_step_domain" CHECK ("change_request_steps"."step" in ('client', 'pm', 'director', 'ccb'));--> statement-breakpoint
ALTER TABLE "change_request_steps" ADD CONSTRAINT "change_request_steps_decision_domain" CHECK ("change_request_steps"."decision" in ('pending', 'rejected', 'ok', 'na'));--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_number_shape" CHECK ("change_requests"."number" ~ '^CR-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_title_filled" CHECK (length(btrim("change_requests"."title")) > 0);--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_types_domain" CHECK ("change_requests"."types" <@ array['budget', 'scope', 'schedule']::text[]);--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_status_domain" CHECK ("change_requests"."status" in ('draft', 'approved', 'rejected', 'in_review'));--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_contract_impact_domain" CHECK ("change_requests"."contract_impact" in ('none', 'price', 'dates', 'price_dates'));--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_linked_entity_type_domain" CHECK ("contingency_draws"."linked_entity_type" in ('change_request', 'risk', 'ncr'));--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_status_domain" CHECK ("contingency_draws"."status" in ('rejected', 'submitted', 'validated'));--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_number_shape" CHECK ("risks"."number" ~ '^R-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_title_filled" CHECK (length(btrim("risks"."title")) > 0);--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_probability_range" CHECK ("risks"."probability" between 1 and 5);--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_impact_range" CHECK ("risks"."impact" between 1 and 5);--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_response_domain" CHECK ("risks"."response" in ('avoid', 'mitigate', 'transfer', 'accept'));--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_status_domain" CHECK ("risks"."status" in ('open', 'closed'));--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_trend_domain" CHECK ("risks"."trend" in ('up', 'flat', 'down'));--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_period_domain" CHECK ("status_reports"."period" in ('month', 'quarter', 'since_start'));--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_audience_domain" CHECK ("status_reports"."audience" in ('client', 'internal', 'steering'));--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_sections_domain" CHECK ("status_reports"."sections" in ('full', 'summary', 'kpis'));--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD CONSTRAINT "status_snapshots_week_code_shape" CHECK ("status_snapshots"."week_code" ~ '^W[0-9]{1,2}$');--> statement-breakpoint
ALTER TABLE "resource_request_events" ADD CONSTRAINT "resource_request_events_action_domain" CHECK ("resource_request_events"."action" in ('approved', 'rejected', 'withdrawn', 'sent', 'reschedule', 'drafted', 'accepted', 'resent', 'named'));--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_number_shape" CHECK ("resource_requests"."number" ~ '^RQ-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_title_filled" CHECK (length(btrim("resource_requests"."title")) > 0);--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_priority_domain" CHECK ("resource_requests"."priority" in ('low', 'med', 'high'));--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_status_domain" CHECK ("resource_requests"."status" in ('draft', 'pending', 'approved', 'rejected', 'withdrawn', 'reschedule'));--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_name_filled" CHECK (length(btrim("task_attachments"."name")) > 0);--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_kind_domain" CHECK ("task_attachments"."kind" in ('pdf', 'xls', 'image', 'doc', 'other'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_shape" CHECK ("tasks"."number" ~ '^T-[0-9]{4,}$');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_filled" CHECK (length(btrim("tasks"."title")) > 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_domain" CHECK ("tasks"."status" in ('done', 'todo', 'doing', 'review'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_domain" CHECK ("tasks"."priority" in ('low', 'med', 'high'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_percent_complete_range" CHECK ("tasks"."percent_complete" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_origin_domain" CHECK ("tasks"."origin" in ('activity_todo', 'request', 'meeting', 'manual'));--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_hours_range" CHECK ("time_entries"."hours" >= 0);--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_source_domain" CHECK ("time_entries"."source" in ('keystone', 'lucca'));--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_load_pct_range" CHECK ("allocations"."load_pct" >= 0);--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_name_filled" CHECK (length(btrim("certifications"."name")) > 0);--> statement-breakpoint
ALTER TABLE "hours_imports" ADD CONSTRAINT "hours_imports_matching_mode_domain" CHECK ("hours_imports"."matching_mode" in ('resource_wp', 'resource'));--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_days_range" CHECK ("leave_entries"."days" >= 0);--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_end_date_order" CHECK ("leave_entries"."end_date" >= "leave_entries"."start_date");--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_code_domain" CHECK ("leave_types"."code" in ('leave', 'absence'));--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_label_filled" CHECK (length(btrim("leave_types"."label")) > 0);--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_country_code_shape" CHECK ("public_holidays"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_name_filled" CHECK (length(btrim("public_holidays"."name")) > 0);--> statement-breakpoint
ALTER TABLE "rate_multipliers" ADD CONSTRAINT "rate_multipliers_label_filled" CHECK (length(btrim("rate_multipliers"."label")) > 0);--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_name_filled" CHECK (length(btrim("skills"."name")) > 0);--> statement-breakpoint
ALTER TABLE "whatif_auto_levers" ADD CONSTRAINT "whatif_auto_levers_priority_domain" CHECK ("whatif_auto_levers"."priority" in ('date', 'budget', 'people'));--> statement-breakpoint
ALTER TABLE "whatif_levers" ADD CONSTRAINT "whatif_levers_label_filled" CHECK (length(btrim("whatif_levers"."label")) > 0);--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_kind_domain" CHECK ("whatif_scenario_actions"."kind" in ('overtime', 'extra_resource', 'shift'));--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_label_filled" CHECK (length(btrim("whatif_scenario_actions"."label")) > 0);--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD CONSTRAINT "whatif_scenarios_name_filled" CHECK (length(btrim("whatif_scenarios"."name")) > 0);--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD CONSTRAINT "whatif_scenarios_priority_domain" CHECK ("whatif_scenarios"."priority" in ('date', 'budget', 'people'));--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_kind_domain" CHECK ("activity_events"."kind" in ('client', 'snapshot', 'quality', 'request', 'sync', 'delivery', 'eco', 'invoice', 'stock', 'comment', 'change'));--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_mail_state_domain" CHECK ("notification_recipients"."mail_state" in ('failed', 'sent', 'immediate', 'digest', 'sending', 'digested', 'seen', 'off', 'no_transport', 'no_address', 'not_visible'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_code_shape" CHECK ("notifications"."code" ~ '^n[0-9]{1,}$');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_domain" CHECK ("notifications"."kind" in ('quality', 'approval', 'request', 'sync', 'alert', 'delivery', 'eco', 'mention', 'invoice', 'task'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_title_filled" CHECK (length(btrim("notifications"."title")) > 0);--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_kind_domain" CHECK ("codex_document_outbox"."kind" in ('approval', 'circuit_start', 'deposit'));--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_role_domain" CHECK ("codex_document_outbox"."role" in ('client', 'author', 'engineering_lead', 'project_manager', 'quality_manager', 'direction', 'quality_verification', 'hse_officer', 'buyer', 'site_manager', 'auditor'));--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_decision_domain" CHECK ("codex_document_outbox"."decision" in ('approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_sync_status_domain" CHECK ("codex_document_outbox"."sync_status" in ('pending', 'failed', 'sent'));--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_role_domain" CHECK ("document_approvals"."role" in ('client', 'author', 'engineering_lead', 'project_manager', 'quality_manager', 'direction', 'quality_verification', 'hse_officer', 'buyer', 'site_manager', 'auditor'));--> statement-breakpoint
ALTER TABLE "document_approver_assignments" ADD CONSTRAINT "document_approver_assignments_role_domain" CHECK ("document_approver_assignments"."role" in ('client', 'author', 'engineering_lead', 'project_manager', 'quality_manager', 'direction', 'quality_verification', 'hse_officer', 'buyer', 'site_manager', 'auditor'));--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_number_filled" CHECK (length(btrim("document_deposits"."number")) > 0);--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_status_domain" CHECK ("document_deposits"."status" in ('handed_off', 'recorded'));--> statement-breakpoint
ALTER TABLE "document_index_syncs" ADD CONSTRAINT "document_index_syncs_source_domain" CHECK ("document_index_syncs"."source" in ('keystone', 'codex'));--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_kind_domain" CHECK ("document_links"."kind" in ('change_request', 'deliverable', 'article', 'purchase_order', 'punch_item', 'shipment'));--> statement-breakpoint
ALTER TABLE "document_type_circuit_steps" ADD CONSTRAINT "document_type_circuit_steps_role_domain" CHECK ("document_type_circuit_steps"."role" in ('client', 'author', 'engineering_lead', 'project_manager', 'quality_manager', 'direction', 'quality_verification', 'hse_officer', 'buyer', 'site_manager', 'auditor'));--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_code_filled" CHECK (length(btrim("document_types"."code")) > 0);--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_label_filled" CHECK (length(btrim("document_types"."label")) > 0);--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_family_domain" CHECK ("document_types"."family" in ('client', 'eng', 'quality', 'purchasing', 'site', 'contracts', 'photos'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_number_filled" CHECK (length(btrim("documents"."number")) > 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_title_filled" CHECK (length(btrim("documents"."title")) > 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_service_domain" CHECK ("documents"."service" in ('auto', 'pm', 'quality', 'site', 'process', 'meca', 'elec', 'procurement'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_status_domain" CHECK ("documents"."status" in ('draft', 'obsolete', 'frozen', 'release_proposed', 'released'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_confidentiality_domain" CHECK ("documents"."confidentiality" in ('client', 'internal', 'supplier'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_recipients_domain" CHECK ("documents"."recipients" <@ array['client', 'auto', 'site', 'process', 'meca', 'elec', 'achats']::text[]);--> statement-breakpoint
ALTER TABLE "billing_plans" ADD CONSTRAINT "billing_plans_model_domain" CHECK ("billing_plans"."model" in ('client_milestones', 'client_monthly_progress', 'client_fixed_price', 'internal_capex'));--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_subject_filled" CHECK (length(btrim("contract_amendments"."subject")) > 0);--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_status_domain" CHECK ("contract_amendments"."status" in ('draft', 'sent_for_signature', 'awaiting_signature', 'signed'));--> statement-breakpoint
ALTER TABLE "contract_bonds" ADD CONSTRAINT "contract_bonds_type_domain" CHECK ("contract_bonds"."type" in ('warranty', 'performance', 'advance_payment', 'retention', 'parent_company'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_type_domain" CHECK ("contracts"."type" in ('lump_sum_epc', 'unit_rates', 'cost_plus', 'framework'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_currency_shape" CHECK ("contracts"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_payment_rule_domain" CHECK ("contracts"."payment_rule" in ('net', 'days_eom', 'eom_days'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_retention_pct_range" CHECK ("contracts"."retention_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_number_filled" CHECK (length(btrim("customer_invoices"."number")) > 0);--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_currency_shape" CHECK ("customer_invoices"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_label_filled" CHECK (length(btrim("payment_milestones"."label")) > 0);--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_share_pct_range" CHECK ("payment_milestones"."share_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_status_domain" CHECK ("payment_milestones"."status" in ('planned', 'invoiced', 'paid'));--> statement-breakpoint
ALTER TABLE "client_questions" ADD CONSTRAINT "client_questions_state_domain" CHECK ("client_questions"."state" in ('open', 'answered'));--> statement-breakpoint
ALTER TABLE "meeting_agenda_points" ADD CONSTRAINT "meeting_agenda_points_title_filled" CHECK (length(btrim("meeting_agenda_points"."title")) > 0);--> statement-breakpoint
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_type_domain" CHECK ("meeting_lines"."type" in ('info', 'decision', 'action'));--> statement-breakpoint
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_origin_domain" CHECK ("meeting_lines"."origin" in ('seed', 'transcript', 'manual'));--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_name_filled" CHECK (length(btrim("meeting_participants"."name")) > 0);--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD CONSTRAINT "meeting_transcript_proposals_type_domain" CHECK ("meeting_transcript_proposals"."type" in ('decision', 'action', 'risk', 'question'));--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD CONSTRAINT "meeting_transcript_proposals_status_domain" CHECK ("meeting_transcript_proposals"."status" in ('rejected', 'proposed', 'applied', 'accepted'));--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_source_domain" CHECK ("meeting_transcripts"."source" in ('teams', 'paste', 'file'));--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_analyzer_domain" CHECK ("meeting_transcripts"."analyzer" in ('prototype', 'local', 'claude'));--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_number_shape" CHECK ("meetings"."number" ~ '^MTG-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_title_filled" CHECK (length(btrim("meetings"."title")) > 0);--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_domain" CHECK ("meetings"."series" in ('weekly_site', 'steering_committee', 'engineering_coordination', 'supplier_review', 'kick_off', 'one_off'));--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_type_domain" CHECK ("meetings"."type" in ('internal', 'external'));--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_duration_min_range" CHECK ("meetings"."duration_min" >= 1);--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_domain" CHECK ("meetings"."status" in ('scheduled', 'notes_in_progress', 'minutes_sent'));--> statement-breakpoint
ALTER TABLE "raci_cells" ADD CONSTRAINT "raci_cells_code_domain" CHECK ("raci_cells"."code" in ('A', 'B', 'C', 'R', 'I'));--> statement-breakpoint
ALTER TABLE "raci_columns" ADD CONSTRAINT "raci_columns_label_filled" CHECK (length(btrim("raci_columns"."label")) > 0);--> statement-breakpoint
ALTER TABLE "raci_rows" ADD CONSTRAINT "raci_rows_label_filled" CHECK (length(btrim("raci_rows"."label")) > 0);--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_name_filled" CHECK (length(btrim("stakeholders"."name")) > 0);--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_type_domain" CHECK ("stakeholders"."type" in ('client', 'internal', 'supplier', 'authority', 'third_party'));--> statement-breakpoint
ALTER TABLE "closure_items" ADD CONSTRAINT "closure_items_status_domain" CHECK ("closure_items"."status" in ('done', 'in_progress', 'not_started'));--> statement-breakpoint
ALTER TABLE "commissioning_steps" ADD CONSTRAINT "commissioning_steps_step_domain" CHECK ("commissioning_steps"."step" in ('sat', 'mechanical_completion', 'pre_commissioning', 'commissioning', 'handover'));--> statement-breakpoint
ALTER TABLE "commissioning_steps" ADD CONSTRAINT "commissioning_steps_status_domain" CHECK ("commissioning_steps"."status" in ('done', 'planned', 'in_progress', 'blocked'));--> statement-breakpoint
ALTER TABLE "commissioning_systems" ADD CONSTRAINT "commissioning_systems_name_filled" CHECK (length(btrim("commissioning_systems"."name")) > 0);--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_status_domain" CHECK ("handover_items"."status" in ('draft', 'ready', 'partial', 'missing'));--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_number_shape" CHECK ("itp_inspections"."number" ~ '^I-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_name_filled" CHECK (length(btrim("itp_inspections"."name")) > 0);--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_point_type_domain" CHECK ("itp_inspections"."point_type" in ('review', 'hold', 'witness', 'surveillance'));--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_stage_domain" CHECK ("itp_inspections"."stage" in ('fat', 'sat', 'workshop', 'site'));--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_result_domain" CHECK ("itp_inspections"."result" in ('planned', 'failed', 'scheduled', 'passed', 'reserved'));--> statement-breakpoint
ALTER TABLE "itp_plan_systems" ADD CONSTRAINT "itp_plan_systems_name_filled" CHECK (length(btrim("itp_plan_systems"."name")) > 0);--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_number_shape" CHECK ("lessons_learned"."number" ~ '^LL-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_theme_domain" CHECK ("lessons_learned"."theme" in ('client', 'quality', 'site', 'procurement', 'hse', 'engineering', 'planning'));--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_status_domain" CHECK ("lessons_learned"."status" in ('validated', 'proposed', 'applied'));--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_number_shape" CHECK ("project_interfaces"."number" ~ '^IF-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_title_filled" CHECK (length(btrim("project_interfaces"."title")) > 0);--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_keystone_side_domain" CHECK ("project_interfaces"."keystone_side" in ('electrical', 'mechanical', 'site', 'process', 'automation'));--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_status_domain" CHECK ("project_interfaces"."status" in ('open', 'frozen', 'received'));--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_register_domain" CHECK ("punch_items"."register" in ('site', 'itp'));--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_number_shape" CHECK ("punch_items"."number" ~ '^P-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_category_domain" CHECK ("punch_items"."category" in ('A', 'B', 'C'));--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_source_domain" CHECK ("punch_items"."source" in ('sat', 'itp', 'site_walk', 'client_inspection', 'reception'));--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_owner_party_domain" CHECK ("punch_items"."owner_party" in ('client', 'keystone'));--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_status_domain" CHECK ("punch_items"."status" in ('open', 'closed', 'in_progress'));--> statement-breakpoint
ALTER TABLE "score_axes" ADD CONSTRAINT "score_axes_code_domain" CHECK ("score_axes"."code" in ('client', 'risk', 'fit', 'margin', 'res'));--> statement-breakpoint
ALTER TABLE "score_axes" ADD CONSTRAINT "score_axes_label_filled" CHECK (length(btrim("score_axes"."label")) > 0);--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_name_filled" CHECK (length(btrim("storage_locations"."name")) > 0);--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_location_type_domain" CHECK ("storage_locations"."location_type" in ('central_warehouse', 'workshop', 'site_store', 'consignment', 'quarantine'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_filled" CHECK (length(btrim("suppliers"."name")) > 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_on_time_delivery_pct_range" CHECK ("suppliers"."on_time_delivery_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_quality_acceptance_pct_range" CHECK ("suppliers"."quality_acceptance_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_ncr_rate_pct_range" CHECK ("suppliers"."ncr_rate_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_grade_domain" CHECK ("suppliers"."grade" in ('A', 'B', 'C'));--> statement-breakpoint
ALTER TABLE "assembly_links" ADD CONSTRAINT "assembly_links_quantity_range" CHECK ("assembly_links"."quantity" >= 0);--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_ref_filled" CHECK (length(btrim("parts"."ref")) > 0);--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_name_filled" CHECK (length(btrim("parts"."name")) > 0);--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_make_buy_domain" CHECK ("parts"."make_buy" in ('manufactured', 'purchased'));--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_part_type_domain" CHECK ("parts"."part_type" in ('structural', 'heavy_equipment', 'electrical', 'hvac', 'fire_safety', 'architectural', 'medical', 'mechanical', 'electronics', 'it_hardware', 'assembly', 'consumable', 'software'));--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_export_control_domain" CHECK ("parts"."export_control" in ('dual_use', 'encryption', 'dangerous_goods', 'medical_device', 'anti_dumping'));--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_status_domain" CHECK ("parts"."status" in ('validated', 'not_validated', 'outdated', 'obsolete'));--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_wear_spare_domain" CHECK ("parts"."wear_spare" in ('PU', 'PR'));--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_unit_domain" CHECK ("parts"."unit" in ('pc', 'm', 'kg', 'set'));--> statement-breakpoint
ALTER TABLE "spare_list_lines" ADD CONSTRAINT "spare_list_lines_kind_domain" CHECK ("spare_list_lines"."kind" in ('PU', 'PR'));--> statement-breakpoint
ALTER TABLE "spare_list_lines" ADD CONSTRAINT "spare_list_lines_qty_per_system_range" CHECK ("spare_list_lines"."qty_per_system" >= 0);--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_number_filled" CHECK (length(btrim("drawings"."number")) > 0);--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_title_filled" CHECK (length(btrim("drawings"."title")) > 0);--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_state_domain" CHECK ("drawings"."state" in ('obsolete', 'released', 'wip', 'under_review'));--> statement-breakpoint
ALTER TABLE "pdm_vault_syncs" ADD CONSTRAINT "pdm_vault_syncs_source_domain" CHECK ("pdm_vault_syncs"."source" in ('solidworks_3dx', 'see_electrical', 'both'));--> statement-breakpoint
ALTER TABLE "pdm_vault_syncs" ADD CONSTRAINT "pdm_vault_syncs_scope_domain" CHECK ("pdm_vault_syncs"."scope" in ('current_project', 'all_projects'));--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_quantity_range" CHECK ("project_bom_lines"."quantity" >= 0);--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_scope_domain" CHECK ("project_bom_lines"."scope" in ('client', 'keystone', 'overlay'));--> statement-breakpoint
ALTER TABLE "revision_diff_lines" ADD CONSTRAINT "revision_diff_lines_name_filled" CHECK (length(btrim("revision_diff_lines"."name")) > 0);--> statement-breakpoint
ALTER TABLE "revision_diff_lines" ADD CONSTRAINT "revision_diff_lines_kind_domain" CHECK ("revision_diff_lines"."kind" in ('quantity', 'substitution', 'added'));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_number_shape" CHECK ("goods_receipts"."number" ~ '^BL-[0-9]{4}-[0-9]{4,}$');--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_status_domain" CHECK ("goods_receipts"."status" in ('rejected', 'accepted', 'received', 'announced', 'qc_pending', 'partially_rejected'));--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_ordered_qty_range" CHECK ("po_lines"."ordered_qty" >= 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_received_qty_range" CHECK ("po_lines"."received_qty" >= 0);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_number_shape" CHECK ("purchase_orders"."number" ~ '^PO-[0-9]{4,}$');--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_domain" CHECK ("purchase_orders"."status" in ('draft', 'ordered', 'cancelled', 'received', 'awaiting_approval', 'partially_received'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_origin_domain" CHECK ("purchase_orders"."origin" in ('x3', 'shortfall', 'rfq', 'spares'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_shape" CHECK ("purchase_orders"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "receipt_attachments" ADD CONSTRAINT "receipt_attachments_kind_domain" CHECK ("receipt_attachments"."kind" in ('photo', 'document'));--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_ordered_qty_range" CHECK ("receipt_lines"."ordered_qty" >= 0);--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_delivered_qty_range" CHECK ("receipt_lines"."delivered_qty" >= 0);--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_accepted_qty_range" CHECK ("receipt_lines"."accepted_qty" >= 0);--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_rejected_qty_range" CHECK ("receipt_lines"."rejected_qty" >= 0);--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_grade_domain" CHECK ("rfq_quotes"."grade" in ('A', 'B', 'C'));--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_number_shape" CHECK ("rfqs"."number" ~ '^RFQ-[0-9]{4}-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_title_filled" CHECK (length(btrim("rfqs"."title")) > 0);--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_quantity_range" CHECK ("rfqs"."quantity" >= 0);--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_status_domain" CHECK ("rfqs"."status" in ('draft', 'open', 'comparing', 'awarded'));--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_award_rule_domain" CHECK ("rfqs"."award_rule" in ('lowest_tco', 'technical_first', 'lowest_price', 'pm_decides'));--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_incoterm_domain" CHECK ("rfqs"."incoterm" in ('DAP', 'EXW', 'FCA', 'DDP'));--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_number_filled" CHECK (length(btrim("supplier_invoices"."number")) > 0);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_currency_shape" CHECK ("supplier_invoices"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_status_domain" CHECK ("supplier_invoices"."status" in ('rejected', 'blocked', 'paid', 'awaiting_receipt', 'no_po', 'approved_for_payment'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_movement_type_domain" CHECK ("stock_movements"."movement_type" in ('reserve', 'transfer', 'adjust', 'release', 'issue', 'return', 'scrap', 'receipt'));--> statement-breakpoint
ALTER TABLE "stock_positions" ADD CONSTRAINT "stock_positions_min_qty_range" CHECK ("stock_positions"."min_qty" >= 0);--> statement-breakpoint
ALTER TABLE "stock_positions" ADD CONSTRAINT "stock_positions_source_domain" CHECK ("stock_positions"."source" in ('local', 'x3'));--> statement-breakpoint
ALTER TABLE "x3_sync_runs" ADD CONSTRAINT "x3_sync_runs_kind_domain" CHECK ("x3_sync_runs"."kind" in ('stock_import', 'stock_push'));--> statement-breakpoint
ALTER TABLE "vigie_eco_approvals" ADD CONSTRAINT "vigie_eco_approvals_approval_key_domain" CHECK ("vigie_eco_approvals"."approval_key" in ('pm', 'quality', 'englead'));--> statement-breakpoint
ALTER TABLE "vigie_eco_approvals" ADD CONSTRAINT "vigie_eco_approvals_decision_domain" CHECK ("vigie_eco_approvals"."decision" in ('pending', 'rejected', 'ok'));--> statement-breakpoint
ALTER TABLE "vigie_eco_effectivity" ADD CONSTRAINT "vigie_eco_effectivity_target_type_domain" CHECK ("vigie_eco_effectivity"."target_type" in ('project', 'machine'));--> statement-breakpoint
ALTER TABLE "vigie_eco_effectivity" ADD CONSTRAINT "vigie_eco_effectivity_disposition_domain" CHECK ("vigie_eco_effectivity"."disposition" in ('na', 'update', 'pinned', 'retrofit'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_kind_domain" CHECK ("vigie_eco_progress"."kind" in ('approval', 'step'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_approval_key_domain" CHECK ("vigie_eco_progress"."approval_key" in ('pm', 'quality', 'englead'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_decision_domain" CHECK ("vigie_eco_progress"."decision" in ('rejected', 'ok'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_target_status_domain" CHECK ("vigie_eco_progress"."target_status" in ('draft', 'rejected', 'released', 'impact_analysis', 'in_approval'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_from_status_domain" CHECK ("vigie_eco_progress"."from_status" in ('draft', 'rejected', 'released', 'impact_analysis', 'in_approval'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_sync_status_domain" CHECK ("vigie_eco_progress"."sync_status" in ('pending', 'failed', 'sent', 'refused'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_vigie_outcome_domain" CHECK ("vigie_eco_progress"."vigie_outcome" in ('rejected', 'applied', 'received'));--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_vigie_result_code_domain" CHECK ("vigie_eco_progress"."vigie_result_code" in ('stale', 'refused', 'not_found', 'invalid'));--> statement-breakpoint
ALTER TABLE "vigie_ecos" ADD CONSTRAINT "vigie_ecos_eco_type_domain" CHECK ("vigie_ecos"."eco_type" in ('rev', 'sub', 'asm', 'sup', 'obs'));--> statement-breakpoint
ALTER TABLE "vigie_ecos" ADD CONSTRAINT "vigie_ecos_status_domain" CHECK ("vigie_ecos"."status" in ('draft', 'rejected', 'released', 'impact_analysis', 'in_approval'));--> statement-breakpoint
ALTER TABLE "vigie_ecos" ADD CONSTRAINT "vigie_ecos_interchangeability_domain" CHECK ("vigie_ecos"."interchangeability" in ('yes', 'no'));--> statement-breakpoint
ALTER TABLE "vigie_hse_items" ADD CONSTRAINT "vigie_hse_items_kind_domain" CHECK ("vigie_hse_items"."kind" in ('prevention_plan', 'induction', 'permit', 'register'));--> statement-breakpoint
ALTER TABLE "vigie_hse_items" ADD CONSTRAINT "vigie_hse_items_status_domain" CHECK ("vigie_hse_items"."status" in ('pending', 'recorded', 'ready', 'signed'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_kind_domain" CHECK ("vigie_ncr_progress"."kind" in ('step', 'verification'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_decision_domain" CHECK ("vigie_ncr_progress"."decision" in ('approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_from_status_domain" CHECK ("vigie_ncr_progress"."from_status" in ('open', 'closed', 'containment', 'root_cause', 'corrective_action', 'verification'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_target_status_domain" CHECK ("vigie_ncr_progress"."target_status" in ('open', 'closed', 'containment', 'root_cause', 'corrective_action', 'verification'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_sync_status_domain" CHECK ("vigie_ncr_progress"."sync_status" in ('pending', 'failed', 'sent', 'refused'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_vigie_outcome_domain" CHECK ("vigie_ncr_progress"."vigie_outcome" in ('rejected', 'applied', 'received'));--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_vigie_result_code_domain" CHECK ("vigie_ncr_progress"."vigie_result_code" in ('stale', 'refused', 'not_found', 'invalid'));--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD CONSTRAINT "vigie_ncrs_severity_domain" CHECK ("vigie_ncrs"."severity" in ('minor', 'major', 'critical'));--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD CONSTRAINT "vigie_ncrs_source_domain" CHECK ("vigie_ncrs"."source" in ('client', 'workshop', 'site_inspection', 'goods_receipt', 'survey', 'audit', 'design'));--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD CONSTRAINT "vigie_ncrs_status_domain" CHECK ("vigie_ncrs"."status" in ('open', 'closed', 'containment', 'root_cause', 'corrective_action', 'verification'));--> statement-breakpoint
ALTER TABLE "deliverable_raci" ADD CONSTRAINT "deliverable_raci_raci_role_domain" CHECK ("deliverable_raci"."raci_role" in ('A', 'B', 'C', 'R', 'I'));--> statement-breakpoint
ALTER TABLE "deliverable_raci" ADD CONSTRAINT "deliverable_raci_name_filled" CHECK (length(btrim("deliverable_raci"."name")) > 0);--> statement-breakpoint
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_decision_domain" CHECK ("deliverable_reviews"."decision" in ('rejected', 'accepted'));--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_number_shape" CHECK ("deliverables"."number" ~ '^D-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_title_filled" CHECK (length(btrim("deliverables"."title")) > 0);--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_status_domain" CHECK ("deliverables"."status" in ('rejected', 'planned', 'submitted', 'accepted', 'in_progress', 'internal_review'));--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_number_shape" CHECK ("interventions"."number" ~ '^IV-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_intervention_type_domain" CHECK ("interventions"."intervention_type" in ('corrective', 'diagnosis', 'preventive'));--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_duration_days_range" CHECK ("interventions"."duration_days" >= 0);--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_status_domain" CHECK ("interventions"."status" in ('done', 'planned'));--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_number_shape" CHECK ("machines"."number" ~ '^MCH-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_name_filled" CHECK (length(btrim("machines"."name")) > 0);--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_warranty_status_domain" CHECK ("machines"."warranty_status" in ('in_warranty', 'extended', 'out_of_warranty'));--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_number_shape" CHECK ("warranty_claims"."number" ~ '^WC-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_severity_domain" CHECK ("warranty_claims"."severity" in ('minor', 'major', 'critical'));--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_status_domain" CHECK ("warranty_claims"."status" in ('open', 'diagnosed', 'intervention_planned', 'closed'));--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_coverage_domain" CHECK ("warranty_claims"."coverage" in ('warranty', 'extended_warranty', 'chargeable'));--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_number_shape" CHECK ("daily_reports"."number" ~ '^DR-[0-9]{3,}$');--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_percent_complete_range" CHECK ("daily_reports"."percent_complete" between 0 and 100);--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_weather_domain" CHECK ("daily_reports"."weather" in ('clear', 'rain', 'wind', 'storm'));--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_hse_incident_domain" CHECK ("daily_reports"."hse_incident" in ('none', 'near_miss', 'first_aid', 'incident'));--> statement-breakpoint
ALTER TABLE "mission_cost_lines" ADD CONSTRAINT "mission_cost_lines_name_filled" CHECK (length(btrim("mission_cost_lines"."name")) > 0);--> statement-breakpoint
ALTER TABLE "site_collisions" ADD CONSTRAINT "site_collisions_kind_domain" CHECK ("site_collisions"."kind" in ('leave', 'doc', 'load', 'cert'));--> statement-breakpoint
ALTER TABLE "site_conflict_arbitrations" ADD CONSTRAINT "site_conflict_arbitrations_kind_domain" CHECK ("site_conflict_arbitrations"."kind" in ('leave', 'doc', 'load', 'cert'));--> statement-breakpoint
ALTER TABLE "site_equipment" ADD CONSTRAINT "site_equipment_name_filled" CHECK (length(btrim("site_equipment"."name")) > 0);--> statement-breakpoint
ALTER TABLE "site_equipment" ADD CONSTRAINT "site_equipment_source_domain" CHECK ("site_equipment"."source" in ('client', 'shipped', 'local_rental'));--> statement-breakpoint
ALTER TABLE "site_equipment" ADD CONSTRAINT "site_equipment_status_domain" CHECK ("site_equipment"."status" in ('pending', 'confirmed'));--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD CONSTRAINT "site_prerequisites_title_filled" CHECK (length(btrim("site_prerequisites"."title")) > 0);--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD CONSTRAINT "site_prerequisites_status_domain" CHECK ("site_prerequisites"."status" in ('pending', 'signed', 'confirmed'));--> statement-breakpoint
ALTER TABLE "site_rotations" ADD CONSTRAINT "site_rotations_to_on_order" CHECK ("site_rotations"."to_on" >= "site_rotations"."from_on");--> statement-breakpoint
ALTER TABLE "site_sheets" ADD CONSTRAINT "site_sheets_currency_shape" CHECK ("site_sheets"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "site_sheets" ADD CONSTRAINT "site_sheets_end_on_order" CHECK ("site_sheets"."end_on" >= "site_sheets"."start_on");--> statement-breakpoint
ALTER TABLE "cursus_clearances" ADD CONSTRAINT "cursus_clearances_visa_domain" CHECK ("cursus_clearances"."visa" in ('pending', 'approved', 'not_required'));--> statement-breakpoint
ALTER TABLE "cursus_clearances" ADD CONSTRAINT "cursus_clearances_vaccination_domain" CHECK ("cursus_clearances"."vaccination" in ('pending', 'confirmed'));--> statement-breakpoint
ALTER TABLE "cursus_clearances" ADD CONSTRAINT "cursus_clearances_clearance_domain" CHECK ("cursus_clearances"."clearance" in ('pending', 'ok', 'missing', 'expiring'));--> statement-breakpoint
ALTER TABLE "cursus_clearances" ADD CONSTRAINT "cursus_clearances_verdict_domain" CHECK ("cursus_clearances"."verdict" in ('go', 'go_with_reserve', 'no_go'));--> statement-breakpoint
ALTER TABLE "cursus_events" ADD CONSTRAINT "cursus_events_status_domain" CHECK ("cursus_events"."status" in ('error', 'received', 'unresolved', 'ignored'));--> statement-breakpoint
ALTER TABLE "cursus_requests" ADD CONSTRAINT "cursus_requests_kind_domain" CHECK ("cursus_requests"."kind" in ('reminder', 'travel_request'));--> statement-breakpoint
ALTER TABLE "cursus_requests" ADD CONSTRAINT "cursus_requests_sync_status_domain" CHECK ("cursus_requests"."sync_status" in ('pending', 'failed', 'sent'));--> statement-breakpoint
ALTER TABLE "cursus_sync_runs" ADD CONSTRAINT "cursus_sync_runs_mode_domain" CHECK ("cursus_sync_runs"."mode" in ('mock', 'http'));--> statement-breakpoint
ALTER TABLE "cursus_task_pushes" ADD CONSTRAINT "cursus_task_pushes_trigger_domain" CHECK ("cursus_task_pushes"."trigger" in ('job', 'sync'));--> statement-breakpoint
ALTER TABLE "cursus_task_pushes" ADD CONSTRAINT "cursus_task_pushes_mode_domain" CHECK ("cursus_task_pushes"."mode" in ('mock', 'http'));--> statement-breakpoint
ALTER TABLE "cursus_task_pushes" ADD CONSTRAINT "cursus_task_pushes_status_domain" CHECK ("cursus_task_pushes"."status" in ('pending', 'superseded', 'failed', 'sent'));--> statement-breakpoint
ALTER TABLE "eng_changes" ADD CONSTRAINT "eng_changes_recipients_domain" CHECK ("eng_changes"."recipients" <@ array['client', 'auto', 'site', 'process', 'meca', 'elec', 'achats']::text[]);--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_number_filled" CHECK (length(btrim("eng_checks"."number")) > 0);--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_severity_domain" CHECK ("eng_checks"."severity" in ('warning', 'info', 'blocking'));--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_title_filled" CHECK (length(btrim("eng_checks"."title")) > 0);--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_owner_domain" CHECK ("eng_checks"."owner" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_status_domain" CHECK ("eng_checks"."status" in ('open', 'in_progress', 'resolved', 'sent_back'));--> statement-breakpoint
ALTER TABLE "eng_consistency_rules" ADD CONSTRAINT "eng_consistency_rules_label_filled" CHECK (length(btrim("eng_consistency_rules"."label")) > 0);--> statement-breakpoint
ALTER TABLE "eng_disciplines" ADD CONSTRAINT "eng_disciplines_code_domain" CHECK ("eng_disciplines"."code" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_import_deltas" ADD CONSTRAINT "eng_import_deltas_kind_domain" CHECK ("eng_import_deltas"."kind" in ('new', 'changed'));--> statement-breakpoint
ALTER TABLE "eng_import_deltas" ADD CONSTRAINT "eng_import_deltas_label_filled" CHECK (length(btrim("eng_import_deltas"."label")) > 0);--> statement-breakpoint
ALTER TABLE "eng_import_tools" ADD CONSTRAINT "eng_import_tools_label_filled" CHECK (length(btrim("eng_import_tools"."label")) > 0);--> statement-breakpoint
ALTER TABLE "eng_import_tools" ADD CONSTRAINT "eng_import_tools_discipline_domain" CHECK ("eng_import_tools"."discipline" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_imports" ADD CONSTRAINT "eng_imports_consumer_domain" CHECK ("eng_imports"."consumer" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_inputs" ADD CONSTRAINT "eng_inputs_consumer_domain" CHECK ("eng_inputs"."consumer" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_inputs" ADD CONSTRAINT "eng_inputs_provider_party_domain" CHECK ("eng_inputs"."provider_party" in ('client', 'auto', 'site', 'process', 'meca', 'elec', 'achats'));--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_number_filled" CHECK (length(btrim("eng_outputs"."number")) > 0);--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_discipline_domain" CHECK ("eng_outputs"."discipline" in ('auto', 'process', 'meca', 'elec'));--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_name_filled" CHECK (length(btrim("eng_outputs"."name")) > 0);--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_recipients_domain" CHECK ("eng_outputs"."recipients" <@ array['client', 'auto', 'site', 'process', 'meca', 'elec', 'achats']::text[]);--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_state_domain" CHECK ("eng_outputs"."state" in ('blocked', 'ready', 'partial', 'stale'));--> statement-breakpoint
ALTER TABLE "pid_sheets" ADD CONSTRAINT "pid_sheets_status_domain" CHECK ("pid_sheets"."status" in ('obsolete', 'released', 'wip', 'under_review'));--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_kind_domain" CHECK ("pid_tags"."kind" in ('equipment', 'instrument'));--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_scope_domain" CHECK ("pid_tags"."scope" in ('client', 'keystone', 'overlay'));--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_plc_type_domain" CHECK ("pid_tags"."plc_type" in ('P', 'S', 'L'));--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_role_domain" CHECK ("pid_tags"."role" in ('sensor', 'actuator', 'ctrl', 'passive'));--> statement-breakpoint
ALTER TABLE "pid_validation_steps" ADD CONSTRAINT "pid_validation_steps_label_filled" CHECK (length(btrim("pid_validation_steps"."label")) > 0);--> statement-breakpoint
ALTER TABLE "pid_validation_steps" ADD CONSTRAINT "pid_validation_steps_state_domain" CHECK ("pid_validation_steps"."state" in ('done', 'todo', 'doing'));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_key_filled" CHECK (length(btrim("app_settings"."key")) > 0);--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_name_filled" CHECK (length(btrim("connectors"."name")) > 0);--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_kind_domain" CHECK ("connectors"."kind" in ('static', 'vigie', 'cursus'));--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_direction_domain" CHECK ("connectors"."direction" in ('import', 'export', 'both'));--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_status_domain" CHECK ("connectors"."status" in ('ok', 'warning', 'error', 'ready'));--> statement-breakpoint
ALTER TABLE "import_formats" ADD CONSTRAINT "import_formats_name_filled" CHECK (length(btrim("import_formats"."name")) > 0);--> statement-breakpoint
ALTER TABLE "import_formats" ADD CONSTRAINT "import_formats_direction_domain" CHECK ("import_formats"."direction" in ('import', 'export'));--> statement-breakpoint
ALTER TABLE "reference_values" ADD CONSTRAINT "reference_values_list_key_domain" CHECK ("reference_values"."list_key" in ('skills', 'costCats', 'statuses', 'riskCats', 'delivTypes', 'holidays', 'locTypes'));--> statement-breakpoint
ALTER TABLE "reference_values" ADD CONSTRAINT "reference_values_code_filled" CHECK (length(btrim("reference_values"."code")) > 0);--> statement-breakpoint
ALTER TABLE "reference_values" ADD CONSTRAINT "reference_values_label_filled" CHECK (length(btrim("reference_values"."label")) > 0);--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_code_filled" CHECK (length(btrim("calendars"."code")) > 0);--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_name_filled" CHECK (length(btrim("calendars"."name")) > 0);--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_outcome_domain" CHECK ("schedule_runs"."outcome" in ('ok', 'error', 'cycle'));--> statement-breakpoint
ALTER TABLE "export_log" ADD CONSTRAINT "export_log_format_domain" CHECK ("export_log"."format" in ('csv', 'xlsx', 'pdf'));--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_status_domain" CHECK ("import_job_rows"."status" in ('ok', 'warning', 'error'));--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_action_domain" CHECK ("import_job_rows"."action" in ('update', 'create', 'skip'));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind_domain" CHECK ("import_jobs"."kind" in ('bom', 'mspdi', 'xer', 'gan', 'budget_lines', 'parts', 'assignments'));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_mode_domain" CHECK ("import_jobs"."mode" in ('new', 'update'));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_domain" CHECK ("import_jobs"."status" in ('uploaded', 'mapped', 'previewed', 'applied', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_purpose_domain" CHECK ("stored_files"."purpose" in ('import', 'attachment', 'transcript', 'export', 'photo'));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_name_filled" CHECK (length(btrim("stored_files"."name")) > 0);--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_scan_status_domain" CHECK ("stored_files"."scan_status" in ('unscanned', 'clean', 'infected'));--> statement-breakpoint
ALTER TABLE "connector_refresh_claims" ADD CONSTRAINT "connector_refresh_claims_key_filled" CHECK (length(btrim("connector_refresh_claims"."key")) > 0);--> statement-breakpoint
ALTER TABLE "change_request_postings" ADD CONSTRAINT "change_request_postings_amendment_outcome_domain" CHECK ("change_request_postings"."amendment_outcome" in ('prepared', 'exists', 'not_contractual', 'no_contract'));--> statement-breakpoint
ALTER TABLE "capex_mirror" ADD CONSTRAINT "capex_mirror_code_shape" CHECK ("capex_mirror"."code" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "capex_mirror" ADD CONSTRAINT "capex_mirror_country_iso2_shape" CHECK ("capex_mirror"."country_iso2" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "capex_needs" ADD CONSTRAINT "capex_needs_need_ref_shape" CHECK ("capex_needs"."need_ref" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "capex_needs" ADD CONSTRAINT "capex_needs_capex_code_shape" CHECK ("capex_needs"."capex_code" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "capex_sync_runs" ADD CONSTRAINT "capex_sync_runs_source_domain" CHECK ("capex_sync_runs"."source" in ('server', 'simulation'));--> statement-breakpoint
ALTER TABLE "need_answers" ADD CONSTRAINT "need_answers_need_ref_shape" CHECK ("need_answers"."need_ref" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "need_answers" ADD CONSTRAINT "need_answers_capex_code_shape" CHECK ("need_answers"."capex_code" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "matrix_subsidiaries" ADD CONSTRAINT "matrix_subsidiaries_code_shape" CHECK ("matrix_subsidiaries"."code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "matrix_subsidiaries" ADD CONSTRAINT "matrix_subsidiaries_name_filled" CHECK (length(btrim("matrix_subsidiaries"."name")) > 0);--> statement-breakpoint
ALTER TABLE "matrix_subsidiaries" ADD CONSTRAINT "matrix_subsidiaries_country_iso2_shape" CHECK ("matrix_subsidiaries"."country_iso2" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "matrix_subsidiaries" ADD CONSTRAINT "matrix_subsidiaries_currency_shape" CHECK ("matrix_subsidiaries"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_number_filled" CHECK (length(btrim("shipment_documents"."number")) > 0);--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_origin_country_shape" CHECK ("shipment_items"."origin_country" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_received_qty_range" CHECK ("shipment_reception_lines"."received_qty" >= 0);--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_missing_qty_range" CHECK ("shipment_reception_lines"."missing_qty" >= 0);--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_damaged_qty_range" CHECK ("shipment_reception_lines"."damaged_qty" >= 0);--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_kind_domain" CHECK ("reminder_sends"."kind" in ('reminder', 'alert', 'digest', 'report'));--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_email_status_domain" CHECK ("reminder_sends"."email_status" in ('failed', 'sent', 'off', 'no_transport', 'no_address'));--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_ends_on_order" CHECK ("approval_delegations"."ends_on" >= "approval_delegations"."starts_on");--> statement-breakpoint
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_target_finish_source_domain" CHECK ("risk_analysis_runs"."target_finish_source" in ('planned', 'none', 'baseline'));--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_name_filled" CHECK (length(btrim("dashboards"."name")) > 0);--> statement-breakpoint
ALTER TABLE "activity_code_types" ADD CONSTRAINT "activity_code_types_name_filled" CHECK (length(btrim("activity_code_types"."name")) > 0);--> statement-breakpoint
ALTER TABLE "activity_code_values" ADD CONSTRAINT "activity_code_values_code_filled" CHECK (length(btrim("activity_code_values"."code")) > 0);--> statement-breakpoint
ALTER TABLE "activity_code_values" ADD CONSTRAINT "activity_code_values_label_filled" CHECK (length(btrim("activity_code_values"."label")) > 0);--> statement-breakpoint
ALTER TABLE "supplier_schedule_activities" ADD CONSTRAINT "supplier_schedule_activities_code_filled" CHECK (length(btrim("supplier_schedule_activities"."code")) > 0);--> statement-breakpoint
ALTER TABLE "supplier_schedule_activities" ADD CONSTRAINT "supplier_schedule_activities_name_filled" CHECK (length(btrim("supplier_schedule_activities"."name")) > 0);--> statement-breakpoint
ALTER TABLE "supplier_schedule_activities" ADD CONSTRAINT "supplier_schedule_activities_committed_finish_order" CHECK ("supplier_schedule_activities"."committed_finish" >= "supplier_schedule_activities"."committed_start");--> statement-breakpoint
ALTER TABLE "supplier_schedule_activities" ADD CONSTRAINT "supplier_schedule_activities_actual_finish_order" CHECK ("supplier_schedule_activities"."actual_finish" >= "supplier_schedule_activities"."actual_start");--> statement-breakpoint
ALTER TABLE "supplier_schedule_links" ADD CONSTRAINT "supplier_schedule_links_type_domain" CHECK ("supplier_schedule_links"."type" in ('FS', 'SS', 'FF', 'SF'));--> statement-breakpoint
ALTER TABLE "fx_reference_rates" ADD CONSTRAINT "fx_reference_rates_currency_shape" CHECK ("fx_reference_rates"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "po_expediting" ADD CONSTRAINT "po_expediting_fabrication_pct_range" CHECK ("po_expediting"."fabrication_pct" between 0 and 100);--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_number_filled" CHECK (length(btrim("po_inspections"."number")) > 0);--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_kind_domain" CHECK ("po_inspections"."kind" in ('fat', 'material', 'other', 'drawing_review', 'in_process', 'pre_shipment'));--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_name_filled" CHECK (length(btrim("po_inspections"."name")) > 0);--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_result_domain" CHECK ("po_inspections"."result" in ('planned', 'failed', 'passed', 'passed_reserve'));--> statement-breakpoint
ALTER TABLE "po_release_notes" ADD CONSTRAINT "po_release_notes_number_filled" CHECK (length(btrim("po_release_notes"."number")) > 0);--> statement-breakpoint
ALTER TABLE "ce_checklist_items" ADD CONSTRAINT "ce_checklist_items_code_filled" CHECK (length(btrim("ce_checklist_items"."code")) > 0);--> statement-breakpoint
ALTER TABLE "ce_checklist_items" ADD CONSTRAINT "ce_checklist_items_title_filled" CHECK (length(btrim("ce_checklist_items"."title")) > 0);