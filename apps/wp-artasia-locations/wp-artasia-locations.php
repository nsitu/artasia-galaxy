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

register_activation_hook(__FILE__, function () {
    artasia_register_post_types();
    flush_rewrite_rules();
});
