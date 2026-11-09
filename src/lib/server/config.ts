import { z } from 'zod';
import {
	APP_ORIGIN,
	CLOUDINARY_API_KEY,
	CLOUDINARY_API_SECRET,
	CLOUDINARY_CLOUD_NAME,
	MAX_UPLOAD_MB,
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	PUBLIC_SUPABASE_URL,
	SUPABASE_ANON_KEY,
	SUPABASE_OWNER_USER_ID,
	SUPABASE_PUBLISHABLE_KEY,
	SUPABASE_URL,
} from '$app/env/private';

const optionalUrl = z.string().trim().url().optional();
const optionalUuid = z.string().trim().uuid().optional();

function optionalValue(...values: Array<string | undefined>): string | undefined {
	return values.map((value) => value?.trim()).find((value) => value);
}

export interface AppConfig {
	supabaseUrl?: string;
	supabasePublishableKey?: string;
	ownerUserId?: string;
	appOrigin?: string;
	cloudinaryCloudName?: string;
	cloudinaryApiKey?: string;
	cloudinaryApiSecret?: string;
	maxUploadBytes: number;
	supabaseConfigured: boolean;
	ownerConfigured: boolean;
	cloudinaryConfigured: boolean;
}

export function getAppConfig(): AppConfig {
	const supabaseUrl = optionalUrl.safeParse(optionalValue(PUBLIC_SUPABASE_URL, SUPABASE_URL));
	const publishableKey = optionalValue(
		PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		SUPABASE_PUBLISHABLE_KEY,
		PUBLIC_SUPABASE_ANON_KEY,
		SUPABASE_ANON_KEY,
	);
	const ownerUserId = optionalUuid.safeParse(SUPABASE_OWNER_USER_ID?.trim());
	const configuredOrigin = optionalUrl.safeParse(APP_ORIGIN?.trim());
	const cloudName = optionalValue(CLOUDINARY_CLOUD_NAME);
	const cloudinaryApiKey = optionalValue(CLOUDINARY_API_KEY);
	const cloudinaryApiSecret = optionalValue(CLOUDINARY_API_SECRET);
	const configuredLimit = Number.parseInt(MAX_UPLOAD_MB ?? '10', 10);
	const maxUploadMb = Number.isFinite(configuredLimit)
		? Math.max(1, Math.min(configuredLimit, 10))
		: 10;
	const validSupabaseUrl = supabaseUrl.success ? supabaseUrl.data : undefined;
	const validOwnerUserId = ownerUserId.success ? ownerUserId.data : undefined;
	const validAppOrigin = configuredOrigin.success ? configuredOrigin.data : undefined;

	return {
		supabaseUrl: validSupabaseUrl,
		supabasePublishableKey: publishableKey,
		ownerUserId: validOwnerUserId,
		appOrigin: validAppOrigin ? new URL(validAppOrigin).origin : undefined,
		cloudinaryCloudName: cloudName,
		cloudinaryApiKey,
		cloudinaryApiSecret,
		maxUploadBytes: maxUploadMb * 1024 * 1024,
		supabaseConfigured: Boolean(validSupabaseUrl && publishableKey),
		ownerConfigured: Boolean(validOwnerUserId),
		cloudinaryConfigured: Boolean(cloudName && cloudinaryApiKey && cloudinaryApiSecret),
	};
}
