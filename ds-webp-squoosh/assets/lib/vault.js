// Uploads the untouched original to the server-side vault for a converted attachment.
const LOG = '[DS WebP Squoosh]';
const ACTION = 'ds_save_original_backup';

/** Resolves true when the server stored the original; never rejects. */
export async function vaultOriginal({ ajaxUrl, nonce }, attachmentId, original) {
	const fd = new FormData();
	fd.append('action', ACTION);
	fd.append('nonce', String(nonce || ''));
	fd.append('attachment_id', String(attachmentId));
	fd.append('original_file', original, original.name);
	try {
		const res = await fetch(String(ajaxUrl || 'admin-ajax.php'), { method: 'POST', body: fd, credentials: 'same-origin' });
		const json = res.ok ? await res.json().catch(() => null) : null;
		if (json && json.success) return true;
		console.warn(LOG, 'vault backup failed for', original.name, res.status, json);
	} catch (err) {
		console.warn(LOG, 'vault backup failed for', original.name, err);
	}
	return false;
}
