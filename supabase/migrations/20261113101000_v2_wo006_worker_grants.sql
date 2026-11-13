-- V2 WO-006: the render worker needs read-only access to the owner's edit context.
-- Plan writes remain service-role RPCs; the worker only reads validated inputs.
grant select on table public.episodes to service_role;
grant select on table public.episode_revisions to service_role;
grant select on table public.scenes to service_role;
grant select on table public.video_assets to service_role;
