-- Fix the object_key backslash check in the WO-007 narration table.
alter table public.narration_takes
  drop constraint if exists narration_takes_object_key_check;
alter table public.narration_takes
  add constraint narration_takes_object_key_check check (
    char_length(btrim(object_key)) between 1 and 512
    and object_key !~ '^/'
    and object_key !~ '(^|/)\.\.(/|$)'
    and object_key !~ '\\'
  );
