<?php
/**
 * Plugin Name: Artasia Locations
 * Description: Custom post types for Artasia venues, sites, and partners with a REST API endpoint for the Node.js backend.
 * Version:     1.0.0
 * License:     GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ARTASIA_LOCATIONS_VERSION', '1.0.0');
define('ARTASIA_LOCATIONS_PATH', plugin_dir_path(__FILE__));
define('ARTASIA_LOCATIONS_URL', plugin_dir_url(__FILE__));

require_once ARTASIA_LOCATIONS_PATH . 'includes/post-types.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/meta-fields.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/meta-boxes.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/rest-fields.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/admin-columns.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/import.php';

function artasia_admin_enqueue_assets(string $hook_suffix): void
{
    if (!in_array($hook_suffix, ['post.php', 'post-new.php', 'edit.php'], true)) {
        return;
    }

    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_venue', 'artasia_partner', 'artasia_site', 'artasia_people'], true)) {
        return;
    }

    if ($screen->post_type === 'artasia_site' && !in_array($hook_suffix, ['post.php', 'post-new.php', 'edit.php'], true)) {
        return;
    }

    $admin_asset_version = (string) max(
        filemtime(ARTASIA_LOCATIONS_PATH . 'assets/admin.js'),
        filemtime(ARTASIA_LOCATIONS_PATH . 'assets/admin.css')
    );

    if (in_array($screen->post_type, ['artasia_partner', 'artasia_people'], true) && in_array($hook_suffix, ['post.php', 'post-new.php'], true)) {
        wp_enqueue_media();
        wp_enqueue_script(
            'artasia-locations-admin',
            ARTASIA_LOCATIONS_URL . 'assets/admin.js',
            ['jquery'],
            $admin_asset_version,
            true
        );
    }

    wp_enqueue_style(
        'artasia-locations-admin',
        ARTASIA_LOCATIONS_URL . 'assets/admin.css',
        [],
        $admin_asset_version
    );
}
add_action('admin_enqueue_scripts', 'artasia_admin_enqueue_assets');

function artasia_allow_partner_logo_mime_types(array $mime_types): array
{
    if (current_user_can('upload_files')) {
        $mime_types['svg'] = 'image/svg+xml';
        $mime_types['png'] = 'image/png';
    }

    return $mime_types;
}
add_filter('upload_mimes', 'artasia_allow_partner_logo_mime_types');

function artasia_check_svg_filetype(array $data, string $file, string $filename, ?array $mimes = null): array
{
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if ($extension !== 'svg') {
        return $data;
    }

    if (!current_user_can('upload_files')) {
        return $data;
    }

    return [
        'ext'             => 'svg',
        'type'            => 'image/svg+xml',
        'proper_filename' => $data['proper_filename'] ?? false,
    ];
}
add_filter('wp_check_filetype_and_ext', 'artasia_check_svg_filetype', 10, 4);

register_activation_hook(__FILE__, function () {
    artasia_register_post_types();
    flush_rewrite_rules();
});
