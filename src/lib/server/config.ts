import { z } from 'zod';
import {
	APP_ORIGIN,
	CLOUDINARY_API_KEY,
	CLOUDINARY_API_SECRET,
	CLOUDINARY_CLOUD_NAME,
	MAX_UPLOAD_MB,
	MAX_VIDEO_MB,
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	PUBLIC_SUPABASE_URL,
	R2_ACCESS_KEY_ID,
	R2_ACCOUNT_ID,
	R2_BUCKET,
	R2_ENDPOINT,
	R2_SECRET_ACCESS_KEY,
	SUPABASE_ANON_KEY,
	SUPABASE_OWNER_USER_ID,
	SUPABASE_PUBLISHABLE_KEY,
	SUPABASE_URL,
	VIDEO_PART_SIZE_MB,
	VIDEO_PROBE_DRIVER,
	VIDEO_STORAGE_DRIVER,
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
	r2AccountId?: string;
	r2AccessKeyId?: string;
	r2SecretAccessKey?: string;
	r2Bucket?: string;
	r2Endpoint?: string;
	r2Configured: boolean;
	videoStorageDriver: 'r2' | 'memory';
	videoProbeDriver: 'ffprobe' | 'fixture' | 'none';
	maxVideoBytes: number;
	videoPartBytes: number;
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
	const r2AccountId = optionalValue(R2_ACCOUNT_ID);
	const r2AccessKeyId = optionalValue(R2_ACCESS_KEY_ID);
	const r2SecretAccessKey = optionalValue(R2_SECRET_ACCESS_KEY);
	const r2Bucket = optionalValue(R2_BUCKET);
	const configuredR2Endpoint = optionalUrl.safeParse(R2_ENDPOINT?.trim());
	const r2Endpoint = configuredR2Endpoint.success
		? configuredR2Endpoint.data
		: r2AccountId
			? `https://${r2AccountId}.r2.cloudflarestorage.com`
			: undefined;
	const storageDriver = VIDEO_STORAGE_DRIVER?.trim().toLowerCase() === 'memory' ? 'memory' : 'r2';
	const probeValue = VIDEO_PROBE_DRIVER?.trim().toLowerCase();
	const videoProbeDriver =
		probeValue === 'ffprobe' || probeValue === 'fixture' || probeValue === 'none'
			? probeValue
			: 'none';
	const configuredVideoLimit = Number.parseInt(MAX_VIDEO_MB ?? '200', 10);
	const maxVideoMb = Number.isFinite(configuredVideoLimit)
		? Math.max(1, Math.min(configuredVideoLimit, 200))
		: 200;
	const configuredPartSize = Number.parseInt(VIDEO_PART_SIZE_MB ?? '8', 10);
	const partSizeMb = Number.isFinite(configuredPartSize)
		? Math.max(5, Math.min(configuredPartSize, 64))
		: 8;

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
		r2AccountId,
		r2AccessKeyId,
		r2SecretAccessKey,
		r2Bucket,
		r2Endpoint,
		r2Configured: Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2Bucket),
		videoStorageDriver: storageDriver,
		videoProbeDriver,
		maxVideoBytes: maxVideoMb * 1024 * 1024,
		videoPartBytes: partSizeMb * 1024 * 1024,
	};
}
