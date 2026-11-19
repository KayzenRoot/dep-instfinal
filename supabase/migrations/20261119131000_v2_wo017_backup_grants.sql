-- V2 WO-017: metadata backup/restore reads legacy owner tables through the
-- service role. These grants are read-only and complement WO-013 hardening.

grant select on table
  public.characters,
  public.lore_facts,
  public.media_assets,
  public.image_references,
  public.generation_jobs,
  public.hook_variants,
  public.character_identity_profiles,
  public.character_identity_profile_versions,
  public.visual_continuity_reports
to service_role;
