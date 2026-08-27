<?php
/**
 * Plugin Name: Artasia Locations
 * Description: Custom post types for Artasia placements, projects, activities, places, partners, supporters, recognitions, people, learning anecdotes, and pedagogical documentation with a REST API endpoint for the Node.js backend.
 * Version:     2.2.33
 * License:     GPL-2.0-or-later
 */


if (!defined('ABSPATH')) {
    exit;
}

define('ARTASIA_LOCATIONS_VERSION', '2.2.33');
define('ARTASIA_LOCATIONS_PATH', plugin_dir_path(__FILE__));
define('ARTASIA_LOCATIONS_URL', plugin_dir_url(__FILE__));

require_once ARTASIA_LOCATIONS_PATH . 'includes/post-types.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/meta-fields.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/meta-boxes.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/rest-fields.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/admin-columns.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/import.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/shortcodes.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/shortcodes-sites.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/shortcodes-logos.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/documentation-gallery.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/shortcodes-documentation.php';
require_once ARTASIA_LOCATIONS_PATH . 'includes/elementor.php';

function artasia_admin_enqueue_assets(string $hook_suffix): void
{
    if (!in_array($hook_suffix, ['post.php', 'post-new.php', 'edit.php'], true)) {
        return;
    }

    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_supporter', 'artasia_place', 'artasia_people', 'artasia_role', 'artasia_recognition', 'artasia_placement', 'artasia_document', 'artasia_anecdote'], true)) {
        return;
    }

    if ($screen->post_type === 'artasia_placement' && !in_array($hook_suffix, ['post.php', 'post-new.php', 'edit.php'], true)) {
        return;
    }

    $admin_asset_version = (string) max(
        filemtime(ARTASIA_LOCATIONS_PATH . 'assets/admin.js'),
        filemtime(ARTASIA_LOCATIONS_PATH . 'assets/admin.css')
    );

    if (in_array($screen->post_type, ['artasia_project', 'artasia_partner', 'artasia_supporter', 'artasia_people', 'artasia_document', 'artasia_placement'], true) && in_array($hook_suffix, ['post.php', 'post-new.php'], true)) {
        if (in_array($screen->post_type, ['artasia_partner', 'artasia_supporter', 'artasia_people'], true)) {
            wp_enqueue_media();
        }
        wp_enqueue_script(
            'artasia-locations-admin',
            ARTASIA_LOCATIONS_URL . 'assets/admin.js',
            ['jquery', 'jquery-ui-sortable'],
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

function artasia_enqueue_public_assets(): void
{
    wp_enqueue_style(
        'artasia-team-shortcode',
        ARTASIA_LOCATIONS_URL . 'assets/team.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_enqueue_style(
        'artasia-sites-shortcode',
        ARTASIA_LOCATIONS_URL . 'assets/sites.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_register_style(
        'artasia-logos-shortcode',
        ARTASIA_LOCATIONS_URL . 'assets/logos.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_enqueue_style(
        'artasia-documentation-shortcode',
        ARTASIA_LOCATIONS_URL . 'assets/documentation.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_enqueue_style('artasia-documentation-gallery');
    wp_register_script(
        'artasia-documentation-shortcode',
        ARTASIA_LOCATIONS_URL . 'assets/documentation.js',
        ['artasia-documentation-gallery'],
        ARTASIA_LOCATIONS_VERSION,
        true
    );
}
add_action('wp_enqueue_scripts', 'artasia_enqueue_public_assets');

function artasia_maybe_flush_rewrite_rules(): void
{
    if (get_option('artasia_locations_rewrite_version') === ARTASIA_LOCATIONS_VERSION) {
        return;
    }

    flush_rewrite_rules(false);
    update_option('artasia_locations_rewrite_version', ARTASIA_LOCATIONS_VERSION);
}
add_action('init', 'artasia_maybe_flush_rewrite_rules', 99);

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
