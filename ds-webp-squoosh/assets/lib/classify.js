// Decides whether a file should be converted to WebP. Pure ES module.
const WEB_FORMATS = new Set(['image/webp', 'image/avif', 'image/svg+xml']);
const GIF_HEADER_LEN = 6;
const LSD_LEN = 7;
const IMAGE_DESCRIPTOR_LEN = 9;

function skipSubBlocks(bytes, pos) {
	while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
	return pos + 1;
}

function colorTableSize(flags) {
	return flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0;
}

// Walks GIF blocks counting image frames; malformed/truncated input => false.
export function isAnimatedGif(bytes) {
	if (bytes.length < GIF_HEADER_LEN + LSD_LEN) return false;
	let pos = GIF_HEADER_LEN + LSD_LEN + colorTableSize(bytes[GIF_HEADER_LEN + 4]);
	let frames = 0;
	while (pos < bytes.length) {
		const block = bytes[pos];
		if (block === 0x3b) break;
		if (block === 0x21) {
			pos = skipSubBlocks(bytes, pos + 2);
		} else if (block === 0x2c) {
			if (++frames > 1) return true;
			const flags = bytes[pos + IMAGE_DESCRIPTOR_LEN];
			pos += 1 + IMAGE_DESCRIPTOR_LEN + colorTableSize(flags);
			pos = skipSubBlocks(bytes, pos + 1); // +1 skips LZW min code size
		} else {
			return false;
		}
	}
	return false;
}

const result = (convert, reason) => ({ convert, reason });

export async function classifyFile(file, { canDecode }) {
	const type = file.type;
	if (!type.startsWith('image/')) return result(false, 'not-image');
	if (WEB_FORMATS.has(type)) return result(false, 'web-format');
	if (type === 'image/gif' && isAnimatedGif(new Uint8Array(await file.arrayBuffer()))) {
		return result(false, 'animated');
	}
	return (await canDecode(file)) ? result(true, null) : result(false, 'undecodable');
}
