// Adapter-node defaults to a 512 KiB request body. Audio uploads are capped at
// 4 MB, so raise the ceiling before the generated server reads its environment.
process.env.BODY_SIZE_LIMIT ||= '5M';
await import('../build/index.js');
