<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_post_types(): void
{
    register_post_type('artasia_venue', [
        'labels' => [
            'name'          => 'Artasia Venues',
            'singular_name' => 'Artasia Venue',
            'add_new_item'  => 'Add New Artasia Venue',
            'edit_item'     => 'Edit Artasia Venue',
            'new_item'      => 'New Artasia Venue',
            'view_item'     => 'View Artasia Venue',
            'search_items'   => 'Search Artasia Venues',
            'not_found'      => 'No Artasia venues found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_venue',
        'menu_icon'    => 'dashicons-location-alt',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_site', [
        'labels' => [
            'name'          => 'Artasia Sites',
            'singular_name' => 'Artasia Site',
            'add_new_item'  => 'Add New Artasia Site',
            'edit_item'     => 'Edit Artasia Site',
            'new_item'      => 'New Artasia Site',
            'view_item'     => 'View Artasia Site',
            'search_items'   => 'Search Artasia Sites',
            'not_found'      => 'No Artasia sites found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_site',
        'menu_icon'    => 'dashicons-art',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_partner', [
        'labels' => [
            'name'          => 'Artasia Partners',
            'singular_name' => 'Artasia Partner',
            'add_new_item'  => 'Add New Artasia Partner',
            'edit_item'     => 'Edit Artasia Partner',
            'new_item'      => 'New Artasia Partner',
            'view_item'     => 'View Artasia Partner',
            'search_items'   => 'Search Artasia Partners',
            'not_found'      => 'No Artasia partners found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_partner',
        'menu_icon'    => 'dashicons-groups',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_people', [
        'labels' => [
            'name'          => 'Artasia People',
            'singular_name' => 'Artasia Person',
            'add_new_item'  => 'Add New Artasia Person',
            'edit_item'     => 'Edit Artasia Person',
            'new_item'      => 'New Artasia Person',
            'view_item'     => 'View Artasia Person',
            'search_items'  => 'Search Artasia People',
            'not_found'     => 'No Artasia people found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_people',
        'menu_icon'    => 'dashicons-id-alt',
        'supports'     => ['title'],
    ]);
}

add_action('init', 'artasia_register_post_types');

function artasia_register_admin_menu(): void
{
    add_menu_page(
        'Artasia',
        'Artasia',
        'edit_posts',
        'edit.php?post_type=artasia_site',
        '',
        'dashicons-art',
        20
    );

    add_submenu_page(
        'edit.php?post_type=artasia_site',
        'Artasia Sites',
        'Sites',
        'edit_posts',
        'edit.php?post_type=artasia_site'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_site',
        'Artasia Venues',
        'Venues',
        'edit_posts',
        'edit.php?post_type=artasia_venue'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_site',
        'Artasia Partners',
        'Partners',
        'edit_posts',
        'edit.php?post_type=artasia_partner'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_site',
        'Artasia People',
        'People',
        'edit_posts',
        'edit.php?post_type=artasia_people'
    );
}
add_action('admin_menu', 'artasia_register_admin_menu');

function artasia_admin_parent_file($parent_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_site', 'artasia_venue', 'artasia_partner', 'artasia_people'], true)) {
        return $parent_file;
    }

    return 'edit.php?post_type=artasia_site';
}
add_filter('parent_file', 'artasia_admin_parent_file');

function artasia_admin_submenu_file($submenu_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_site', 'artasia_venue', 'artasia_partner', 'artasia_people'], true)) {
        return $submenu_file;
    }

    return 'edit.php?post_type=' . $screen->post_type;
}
add_filter('submenu_file', 'artasia_admin_submenu_file');
