import { defineEnvVars } from '@sveltejs/kit/env';

const optionalString = (value: string | undefined) => value;

export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: { schema: optionalString },
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: { schema: optionalString },
	PUBLIC_SUPABASE_ANON_KEY: { schema: optionalString },
	SUPABASE_URL: { schema: optionalString },
	SUPABASE_PUBLISHABLE_KEY: { schema: optionalString },
	SUPABASE_ANON_KEY: { schema: optionalString },
	SUPABASE_OWNER_USER_ID: { schema: optionalString },
	APP_ORIGIN: { schema: optionalString },
	CLOUDINARY_CLOUD_NAME: { schema: optionalString },
	CLOUDINARY_API_KEY: { schema: optionalString },
	CLOUDINARY_API_SECRET: { schema: optionalString },
	MAX_UPLOAD_MB: { schema: optionalString },
	R2_ACCOUNT_ID: { schema: optionalString },
	R2_ACCESS_KEY_ID: { schema: optionalString },
	R2_SECRET_ACCESS_KEY: { schema: optionalString },
	R2_BUCKET: { schema: optionalString },
	R2_ENDPOINT: { schema: optionalString },
	VIDEO_STORAGE_DRIVER: { schema: optionalString },
	VIDEO_PROBE_DRIVER: { schema: optionalString },
	MAX_VIDEO_MB: { schema: optionalString },
	VIDEO_PART_SIZE_MB: { schema: optionalString },
});
