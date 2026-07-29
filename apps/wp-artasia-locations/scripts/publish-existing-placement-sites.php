<?php

if (!defined('ABSPATH')) {
    exit;
}

$migration_option = 'artasia_publish_existing_sites_migration_1_4_3';
if (get_option($migration_option)) {
    WP_CLI::success('Existing placement site visibility migration was already applied.');
    return;
}

$placement_ids = get_posts([
    'post_type'      => 'artasia_placement',
    'post_status'    => ['publish', 'draft', 'pending', 'private', 'future'],
    'posts_per_page' => -1,
    'fields'         => 'ids',
    'no_found_rows'  => true,
]);

foreach ($placement_ids as $placement_id) {
    update_post_meta($placement_id, 'artasia_publish_site', true);
}

update_option($migration_option, gmdate('c'), false);

WP_CLI::success(
    sprintf(
        'Enabled Artasia site-listing visibility for %d existing placement%s.',
        count($placement_ids),
        count($placement_ids) === 1 ? '' : 's'
    )
);
