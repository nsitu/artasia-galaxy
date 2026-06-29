<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_upload_tag_taxonomy(): void
{
    register_taxonomy('artasia_upload_tag', ['artasia_placement'], [
        'labels' => [
            'name'          => 'Upload Tags',
            'singular_name' => 'Upload Tag',
            'add_new_item'  => 'Add New Upload Tag',
            'edit_item'     => 'Edit Upload Tag',
            'new_item'      => 'New Upload Tag',
            'view_item'     => 'View Upload Tag',
            'search_items'  => 'Search Upload Tags',
            'not_found'     => 'No upload tags found',
            'all_items'     => 'All Upload Tags',
        ],
        'public'             => true,
        'publicly_queryable' => false,
        'show_ui'            => true,
        'show_in_menu'       => true,
        'show_in_nav_menus'  => false,
        'show_in_rest'       => true,
        'rest_base'          => 'artasia_upload_tag',
        'show_tagcloud'      => false,
        'show_admin_column'  => false,
        'hierarchical'       => false,
        'meta_box_cb'        => false,
    ]);
}
add_action('init', 'artasia_register_upload_tag_taxonomy');

function artasia_register_upload_tag_admin_menu(): void
{
    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Upload Tags',
        'Upload Tags',
        'manage_categories',
        'edit-tags.php?taxonomy=artasia_upload_tag&post_type=artasia_placement'
    );
}
add_action('admin_menu', 'artasia_register_upload_tag_admin_menu');

function artasia_upload_tag_admin_parent_file(string $parent_file): string
{
    $screen = get_current_screen();
    if ($screen && $screen->taxonomy === 'artasia_upload_tag') {
        return 'edit.php?post_type=artasia_placement';
    }
    return $parent_file;
}
add_filter('parent_file', 'artasia_upload_tag_admin_parent_file');