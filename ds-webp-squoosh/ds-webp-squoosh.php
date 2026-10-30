<?php
/**
 * Plugin Name: DS WebP Squoosh Studio
 * Description: Zero-server-load client-side WebP converter (Squoosh's libwebp WASM) for the WP admin. JPEG/PNG uploads are converted in the browser to WebP (quality 82% default, 2460px max edge) before they ever reach the server.
 * Version:     1.2.0
 * Author:      DesignSuite Studio
 * License:     GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_WebP_Squoosh_Studio {

	const VERSION = '1.2.0';

	/**
	 * ---- SETTINGS (edit here; or override via the filters shown) ----------
	 */
	const DEFAULT_QUALITY   = 82;    // WebP quality 1-100, slider default.
	const MAX_DIM           = 2460;  // Downscale when the longest edge exceeds this.
	const KEEP_ORIGINAL     = false; // Default for the per-upload "Keep Original" toggle.
	const VAULT_FOLDER      = 'ds-originals';
	const BACKUP_MAX_BYTES  = 20971520; // 20 MB cap per vaulted original. (`ds_webp_backup_max_bytes` filter)
	const AJAX_ACTION       = 'ds_save_original_backup';

	const VAULT_EXTENSIONS  = [ 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif' ];
	const VAULT_MIMES       = [ 'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/x-ms-bmp', 'image/tiff' ];
	const HEIC_EXTENSIONS   = [ 'heic', 'heif' ];
	const MODULE_MIN_WP     = '6.6'; // Script modules in wp-admin are only reliable from 6.6.

	private $vault_token = null;
	private $enqueued    = false;
	private $printed     = false;

	public function __construct() {
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_studio_assets' ] );
		add_action( 'elementor/editor/before_enqueue_scripts', [ $this, 'enqueue_studio_assets' ] );
		add_action( 'admin_head', [ $this, 'print_client_config' ], 0 );
		add_action( 'elementor/editor/wp_head', [ $this, 'print_client_config' ], 0 );
		add_action( 'elementor/editor/after_enqueue_scripts', [ $this, 'print_client_config' ], 0 ); // Fallback; the guard prevents a second print.
		add_action( 'add_attachment', [ $this, 'save_compression_metadata' ] );
		add_action( 'rest_after_insert_attachment', [ $this, 'save_rest_compression_metadata' ], 10, 3 );
		add_action( 'wp_ajax_' . self::AJAX_ACTION, [ $this, 'ajax_save_original_backup' ] );
		add_action( 'delete_attachment', [ $this, 'cleanup_original_backup' ] );

		// Attachment-details panel (media modal sidebar + edit-attachment page).
		add_filter( 'attachment_fields_to_edit', [ $this, 'details_panel_fields' ], 10, 2 );
		add_filter( 'wp_prepare_attachment_for_js', [ $this, 'expose_meta_to_media_model' ], 10, 2 );
	}

	/**
	 * Enqueue studio.js (ES module) + inline config, admin only, uploaders only.
	 */
	public function enqueue_studio_assets() {
		if ( ! current_user_can( 'upload_files' ) ) {
			return;
		}

		$base_url = plugin_dir_url( __FILE__ ) . 'assets/';

		if ( version_compare( get_bloginfo( 'version' ), self::MODULE_MIN_WP, '>=' ) && function_exists( 'wp_enqueue_script_module' ) ) {
			wp_enqueue_script_module( 'ds-webp-squoosh', $base_url . 'studio.js', [], self::VERSION );
		} else {
			// Classic handle printed as a module via script_loader_tag.
			wp_enqueue_script( 'ds-webp-squoosh', $base_url . 'studio.js', [ 'wp-plupload', 'media-editor' ], self::VERSION, true );
			add_filter( 'script_loader_tag', [ $this, 'force_module_type' ], 10, 2 );
		}

		$this->enqueued = true;
		wp_enqueue_style( 'ds-webp-squoosh-studio', $base_url . 'studio.css', [], self::VERSION );
		wp_enqueue_style( 'ds-webp-squoosh-panel', $base_url . 'panel.css', [], self::VERSION );
	}

	/**
	 * Print the inline config in <head> (module scripts are deferred, but editor
	 * scripts are not) and switch off core's experimental client-side media
	 * processing, which would otherwise bypass this plugin in the block editor.
	 * Once per request, only where studio.js was enqueued.
	 */
	public function print_client_config() {
		if ( $this->printed || ! $this->enqueued ) {
			return;
		}
		$this->printed = true;

		$config = wp_json_encode(
			[
				'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
				'nonce'          => wp_create_nonce( 'ds_webp_squoosh_nonce' ),
				'defaultQuality' => (int) apply_filters( 'ds_webp_default_quality', self::DEFAULT_QUALITY ),
				'maxDim'         => (int) apply_filters( 'ds_webp_max_dim', self::MAX_DIM ),
				'defaultBackup'  => (bool) apply_filters( 'ds_webp_keep_original', self::KEEP_ORIGINAL ),
				'maxBackupBytes' => (int) apply_filters( 'ds_webp_backup_max_bytes', self::BACKUP_MAX_BYTES ),
				'webpSupported'  => (bool) wp_image_editor_supports( [ 'mime_type' => 'image/webp' ] ),
			]
		);

		wp_print_inline_script_tag( 'window.__clientSideMediaProcessing = false;' );
		wp_print_inline_script_tag( "window.DSWebPConfig = {$config};" );
	}

	public function force_module_type( $tag, $handle ) {
		if ( 'ds-webp-squoosh' === $handle ) {
			$tag = str_replace( '<script ', '<script type="module" ', $tag );
		}
		return $tag;
	}

	/**
	 * Persist quality + original size sent along with the uploader request
	 * (only for files our JS intercepted).
	 */
	public function save_compression_metadata( $attachment_id ) {
		$this->store_compression_meta(
			(int) $attachment_id,
			$_REQUEST['_ds_webp_quality'] ?? null, // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$_REQUEST['_ds_orig_size'] ?? null // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		);
	}

	/** Block-editor uploads (POST /wp/v2/media) carry the same two fields. */
	public function save_rest_compression_metadata( $attachment, $request, $creating ) {
		if ( ! $creating || ! $attachment instanceof WP_Post ) {
			return;
		}
		$this->store_compression_meta( $attachment->ID, $request->get_param( '_ds_webp_quality' ), $request->get_param( '_ds_orig_size' ) );
	}

	/** Quality clamped 1-100, size absint; empty/zero values store nothing. */
	private function store_compression_meta( $id, $quality, $orig_size ) {
		if ( is_scalar( $quality ) ) {
			$q = min( 100, absint( $quality ) );
			if ( $q ) {
				update_post_meta( $id, '_ds_webp_quality', $q );
			}
		}
		if ( is_scalar( $orig_size ) ) {
			$size = absint( $orig_size );
			if ( $size ) {
				update_post_meta( $id, '_ds_orig_size', $size );
			}
		}
	}

	/**
	 * Vault an untouched original (Keep Original toggle) under
	 * /uploads/ds-originals/{site-token}/YYYY/MM/ and link it via post meta.
	 */
	public function ajax_save_original_backup() {
		check_ajax_referer( 'ds_webp_squoosh_nonce', 'nonce' );

		if ( ! current_user_can( 'upload_files' ) ) {
			wp_send_json_error( [ 'message' => 'Insufficient permissions.' ], 403 );
		}

		$attachment_id = isset( $_POST['attachment_id'] ) ? absint( $_POST['attachment_id'] ) : 0;
		if ( ! $attachment_id || empty( $_FILES['original_file'] ) || ! is_array( $_FILES['original_file'] ) ) {
			wp_send_json_error( [ 'message' => 'Missing attachment ID or file payload.' ], 400 );
		}

		$file = $_FILES['original_file']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

		if ( ! empty( $file['error'] ) || UPLOAD_ERR_OK !== (int) $file['error'] ) {
			wp_send_json_error( [ 'message' => 'Upload error code ' . (int) $file['error'] . '.' ], 400 );
		}
		if ( ! is_uploaded_file( $file['tmp_name'] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			wp_send_json_error( [ 'message' => 'Invalid upload payload.' ], 400 );
		}
		if ( (int) $file['size'] > self::BACKUP_MAX_BYTES ) {
			wp_send_json_error( [ 'message' => 'Original exceeds the backup size cap.' ], 413 );
		}
		if ( is_multisite() && wp_is_large_network() && ! is_super_admin() ) {
			wp_send_json_error( [ 'message' => 'Backup disabled on large networks.' ], 403 );
		}

		// Whitelist: only real raster-image originals belong in the vault.
		$ext = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, self::VAULT_EXTENSIONS, true ) ) {
			wp_send_json_error( [ 'message' => 'This image format cannot be vaulted.' ], 415 );
		}

		$upload_dir = wp_upload_dir();
		$vault_dir  = trailingslashit( $upload_dir['basedir'] ) . self::VAULT_FOLDER;
		$target_dir = trailingslashit( $vault_dir ) . $this->get_vault_token() . $upload_dir['subdir'];

		if ( ! wp_mkdir_p( $target_dir ) ) {
			wp_send_json_error( [ 'message' => 'Could not create vault directory.' ], 500 );
		}
		$this->secure_vault_directory( $vault_dir );

		$raw_name    = sanitize_file_name( $file['name'] );
		$unique_name = wp_unique_filename( $target_dir, $raw_name );
		$target_path = trailingslashit( $target_dir ) . $unique_name;

		if ( ! @move_uploaded_file( $file['tmp_name'], $target_path ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			wp_send_json_error( [ 'message' => 'Failed to write original file to vault.' ], 500 );
		}
		// FS_CHMOD_FILE only exists once WP_Filesystem() ran — never in admin-ajax.
		@chmod( $target_path, defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644 );

		// Integrity check after the move: HEIC/HEIF are not decodable by getimagesize
		// (extension whitelist only); everything else must decode as an allowed image.
		if ( ! in_array( $ext, self::HEIC_EXTENSIONS, true ) ) {
			$check = function_exists( 'getimagesize' ) ? @getimagesize( $target_path ) : false;
			if ( ! $check || empty( $check['mime'] ) || ! in_array( $check['mime'], self::VAULT_MIMES, true ) ) {
				wp_delete_file( $target_path );
				wp_send_json_error( [ 'message' => 'Payload is not a valid image.' ], 415 );
			}
		}

		$relative = ltrim( str_replace( trailingslashit( $upload_dir['basedir'] ), '', $target_path ), '/' );
		update_post_meta( $attachment_id, '_ds_original_backup', $relative );

		wp_send_json_success( [ 'backup_path' => $relative ] );
	}

	/**
	 * Read-only "DS WebP" row for the media modal sidebar + edit-attachment page,
	 * shown only for attachments this plugin converted. Raw `html` input so no
	 * <input>/<select> is emitted and core's compat FormData round-trip stays
	 * untouched.
	 */
	public function details_panel_fields( $form_fields, $post ) {
		if ( ! $post instanceof WP_Post ) {
			return $form_fields;
		}

		$ds        = $this->get_ds_meta( $post->ID );
		$orig_size = $ds['orig_size'];

		if ( ! $ds['quality'] && ! $orig_size && ! $ds['vaulted'] ) {
			return $form_fields;
		}

		// Current WebP file size: image metadata carries `filesize` since WP 6.0;
		// else one stat, skipping the filesystem when metadata has it.
		$meta      = wp_get_attachment_metadata( $post->ID );
		$webp_size = is_array( $meta ) && ! empty( $meta['filesize'] ) ? (int) $meta['filesize'] : 0;
		if ( ! $webp_size ) {
			$file_path = get_attached_file( $post->ID );
			$webp_size = ( $file_path && file_exists( $file_path ) )
				? (int) ( function_exists( 'wp_filesize' ) ? wp_filesize( $file_path ) : filesize( $file_path ) )
				: 0;
		}

		$content = '<div class="ds-webp-details" title="Converted in this browser with Squoosh\'s libwebp encoder (DS WebP Squoosh Studio)">';

		if ( $orig_size ) {
			$content .= '<span class="ds-webp-details__size">Original ' . size_format( $orig_size ) . '</span>';
			if ( $webp_size ) {
				$saved_pct = ( $webp_size < $orig_size )
					? ' · Saved ' . (int) round( ( ( $orig_size - $webp_size ) / $orig_size ) * 100 ) . '%'
					: '';
				$content .= '<span class="ds-webp-details__size"> → ' . size_format( $webp_size ) . ' WebP' . $saved_pct . '</span>'; // String built solely from ints + size_format().
			}
		}
		if ( $ds['quality'] ) {
			$content .= '<span class="ds-webp-details__quality">Quality ' . (int) $ds['quality'] . '%</span>';
		}
		if ( $ds['vaulted'] ) {
			$content .= '<span class="ds-webp-details__vault">Original vaulted: Yes</span>';
		}
		$content .= '</div>';

		$form_fields['dswebp_studio'] = [
			'label' => 'DS WebP',
			'input' => 'html',
			'html'  => $content,
		];

		return $form_fields;
	}

	/**
	 * All compression meta in one cached read: get_post_meta( $id ) with no key
	 * fetches every row in a single query (vs one uncached query per key), and
	 * both details-panel hooks run per attachment in the library grid.
	 *
	 * @return array Keys: quality, orig_size (int), vaulted (string).
	 */
	private function get_ds_meta( $attachment_id ) {
		$all = get_post_meta( $attachment_id );
		if ( ! is_array( $all ) ) {
			return [ 'quality' => 0, 'orig_size' => 0, 'vaulted' => '' ];
		}

		return [
			'quality'   => empty( $all['_ds_webp_quality'][0] ) ? 0 : (int) $all['_ds_webp_quality'][0],
			'orig_size' => empty( $all['_ds_orig_size'][0] ) ? 0 : (int) $all['_ds_orig_size'][0],
			'vaulted'   => empty( $all['_ds_original_backup'][0] ) ? '' : (string) $all['_ds_original_backup'][0],
		];
	}

	/**
	 * Exposes conversion metrics as response['dsWebp'], readable from any admin
	 * JS via attachment.get( 'dsWebp' ); parameters are the core filter's.
	 */
	public function expose_meta_to_media_model( $response, $attachment ) {
		if ( ! is_array( $response ) || ! $attachment instanceof WP_Post ) {
			return $response;
		}

		$ds = $this->get_ds_meta( $attachment->ID );

		$response['dsWebp'] = [
			'origSize' => $ds['orig_size'] ?: null,
			'quality'  => $ds['quality'] ?: null,
			'vaulted'  => (bool) $ds['vaulted'],
		];

		return $response;
	}

	/** Removes the vaulted original when its WebP attachment is deleted. */
	public function cleanup_original_backup( $attachment_id ) {
		$relative = get_post_meta( $attachment_id, '_ds_original_backup', true );
		if ( ! $relative ) {
			return;
		}

		$upload_dir = wp_upload_dir();
		$full_path  = trailingslashit( $upload_dir['basedir'] ) . ltrim( (string) $relative, '/' );
		$vault_base = realpath( trailingslashit( $upload_dir['basedir'] ) . self::VAULT_FOLDER );
		$real       = realpath( $full_path );

		// Never delete outside the vault (path traversal guard).
		if ( $real && $vault_base && 0 === strpos( $real, trailingslashit( $vault_base ) ) && file_exists( $real ) ) {
			wp_delete_file( $real );
		}
		delete_post_meta( $attachment_id, '_ds_original_backup' );
	}

	/** Per-site random token so vault URLs cannot be guessed. */
	private function get_vault_token() {
		if ( null === $this->vault_token ) {
			$this->vault_token = get_option( 'ds_webp_vault_token' );
			if ( ! is_string( $this->vault_token ) || 16 !== strlen( $this->vault_token ) ) {
				$this->vault_token = substr( bin2hex( random_bytes( 8 ) ), 0, 16 );
				update_option( 'ds_webp_vault_token', $this->vault_token );
			}
		}
		return trailingslashit( $this->vault_token );
	}

	/** Apache/LiteSpeed hardening (Hostinger) + no directory listing. */
	private function secure_vault_directory( $vault_root ) {
		$index_file    = trailingslashit( $vault_root ) . 'index.php';
		$htaccess_file = trailingslashit( $vault_root ) . '.htaccess';

		if ( ! file_exists( $index_file ) ) {
			@file_put_contents( $index_file, "<?php\n// Silence is golden.\n" ); // phpcs:ignore
		}
		if ( ! file_exists( $htaccess_file ) ) {
			$rules  = "# DS WebP Squoosh vault - deny direct access\n";
			$rules .= "Options -Indexes\n";
			$rules .= "<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n";
			$rules .= "<IfModule !mod_authz_core.c>\n\tOrder allow,deny\n\tDeny from all\n</IfModule>\n";
			@file_put_contents( $htaccess_file, $rules ); // phpcs:ignore
		}
	}
}

new DS_WebP_Squoosh_Studio();
