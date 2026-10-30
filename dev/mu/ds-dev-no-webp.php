<?php
/**
 * Dev only: simulate a host with no server-side WebP support.
 * Toggle with: wp option update ds_dev_no_webp 1
 */
if ( get_option( 'ds_dev_no_webp' ) ) {
	add_filter( 'wp_image_editors', '__return_empty_array' );
}

// Dev only: application passwords over plain http (REST tests authenticate with one).
add_filter( 'wp_is_application_passwords_available', '__return_true' );
