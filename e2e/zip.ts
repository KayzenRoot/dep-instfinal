import { inflateRawSync } from 'node:zlib';

export function readZipTextEntry(archive: Buffer, entryName: string): string {
	const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
	let centralOffset = archive.indexOf(signature);
	while (centralOffset >= 0) {
		const compressedSize = archive.readUInt32LE(centralOffset + 20);
		const method = archive.readUInt16LE(centralOffset + 10);
		const nameLength = archive.readUInt16LE(centralOffset + 28);
		const extraLength = archive.readUInt16LE(centralOffset + 30);
		const commentLength = archive.readUInt16LE(centralOffset + 32);
		const name = archive.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);
		if (name === entryName) {
			const localOffset = archive.readUInt32LE(centralOffset + 42);
			const localNameLength = archive.readUInt16LE(localOffset + 26);
			const localExtraLength = archive.readUInt16LE(localOffset + 28);
			const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
			const compressed = archive.subarray(contentOffset, contentOffset + compressedSize);
			if (method === 0) return compressed.toString('utf8');
			if (method === 8) return inflateRawSync(compressed).toString('utf8');
			throw new Error(`Unsupported ZIP compression method ${method}.`);
		}
		centralOffset += 46 + nameLength + extraLength + commentLength;
		if (centralOffset > archive.length - 46) break;
		centralOffset = archive.indexOf(signature, centralOffset);
	}
	throw new Error(`ZIP entry ${entryName} was not found.`);
}
