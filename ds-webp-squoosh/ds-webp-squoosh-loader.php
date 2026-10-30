<?php
/**
 * Plugin Name: DS WebP Squoosh Studio (loader)
 * Description: Loads the actual plugin, which lives in the ds-webp-squoosh/ subfolder. MUST sit directly in wp-content/mu-plugins/ — WordPress only auto-loads .php files at that level, never inside subfolders.
 * Version:     1.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/ds-webp-squoosh/ds-webp-squoosh.php';
