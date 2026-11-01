<?php
/**
 * Self-updates from the latest GitHub release through core's `Update URI` hook
 * (WP 5.8+) and opts this plugin into WordPress auto-updates. Inert when the
 * plugin runs as an mu-plugin: WordPress never update-checks those.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_WebP_Squoosh_Updater {

	const REPO       = 'sidhanth-povil/Dsquoosh';
	const ASSET_NAME = 'ds-webp-squoosh.zip'; // Attached to each release by .github/workflows/release.yml.
	const CACHE_KEY  = 'ds_webp_squoosh_release';
	const CACHE_TTL  = 6 * HOUR_IN_SECONDS;  // Unauthenticated GitHub API: 60 requests/hour per IP (shared hosts share IPs).
	const ERROR_TTL  = HOUR_IN_SECONDS;      // Back off after a failed or asset-less lookup.

	private $plugin_file;

	public function __construct( $plugin_file ) {
		$this->plugin_file = plugin_basename( $plugin_file );
		add_filter( 'update_plugins_github.com', [ $this, 'check_update' ], 10, 3 );
		add_filter( 'auto_update_plugin', [ $this, 'force_auto_update' ], 10, 2 );
	}

	/** Core compares `version` against the installed one and fills in id/plugin itself. */
	public function check_update( $update, $plugin_data, $plugin_file ) {
		if ( $plugin_file !== $this->plugin_file ) {
			return $update;
		}

		$release = $this->latest_release();
		if ( ! $release ) {
			return $update;
		}

		return [
			'slug'    => dirname( $this->plugin_file ),
			'version' => $release['version'],
			'url'     => $release['url'],
			'package' => $release['package'],
		];
	}

	public function force_auto_update( $update, $item ) {
		return ( is_object( $item ) && isset( $item->plugin ) && $item->plugin === $this->plugin_file ) ? true : $update;
	}

	/** Cached as a site transient; a failure is cached as version '' for ERROR_TTL. */
	private function latest_release() {
		$cached = get_site_transient( self::CACHE_KEY );
		if ( is_array( $cached ) && isset( $cached['version'] ) ) {
			return '' === $cached['version'] ? null : $cached;
		}

		$release = $this->fetch_release();
		set_site_transient( self::CACHE_KEY, $release ? $release : [ 'version' => '' ], $release ? self::CACHE_TTL : self::ERROR_TTL );
		return $release;
	}

	private function fetch_release() {
		$response = wp_remote_get(
			'https://api.github.com/repos/' . self::REPO . '/releases/latest',
			[
				'timeout' => 10,
				'headers' => [ 'Accept' => 'application/vnd.github+json' ],
			]
		);

		if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			$reason = is_wp_error( $response ) ? $response->get_error_message() : 'HTTP ' . wp_remote_retrieve_response_code( $response );
			error_log( 'DS WebP Squoosh: update check failed (' . $reason . ').' ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			return null;
		}

		return self::parse_release( json_decode( wp_remote_retrieve_body( $response ), true ) );
	}

	/**
	 * GitHub release JSON → [ version, package, url ], or null unless it has a
	 * numeric tag (optional leading "v") and our zip asset hosted in this repo.
	 */
	public static function parse_release( $body ) {
		if ( ! is_array( $body ) || empty( $body['tag_name'] ) || ! is_string( $body['tag_name'] ) || empty( $body['assets'] ) || ! is_array( $body['assets'] ) ) {
			return null;
		}

		$version = ltrim( $body['tag_name'], 'vV' );
		if ( ! preg_match( '/^\d+(\.\d+){1,3}$/', $version ) ) {
			return null;
		}

		$download_prefix = 'https://github.com/' . self::REPO . '/releases/download/';
		foreach ( $body['assets'] as $asset ) {
			if ( ! is_array( $asset ) || ( $asset['name'] ?? '' ) !== self::ASSET_NAME ) {
				continue;
			}
			$package = (string) ( $asset['browser_download_url'] ?? '' );
			if ( 0 !== strpos( $package, $download_prefix ) ) {
				return null;
			}
			return [
				'version' => $version,
				'package' => $package,
				'url'     => 'https://github.com/' . self::REPO . '/releases/tag/' . rawurlencode( $body['tag_name'] ),
			];
		}

		return null;
	}
}
