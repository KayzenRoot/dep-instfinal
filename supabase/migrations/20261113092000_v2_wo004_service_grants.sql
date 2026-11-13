-- V2 WO-004: server-side readers (worker/backup) use service_role.
grant select on table public.video_edit_plans to service_role;
grant select on table public.video_edit_plan_versions to service_role;
