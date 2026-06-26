<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_post_types(): void
{
    register_post_type('artasia_place', [
        'labels' => [
            'name'          => 'Artasia Places',
            'singular_name' => 'Artasia Place',
            'add_new_item'  => 'Add New Artasia Place',
            'edit_item'     => 'Edit Artasia Place',
            'new_item'      => 'New Artasia Place',
            'view_item'     => 'View Artasia Place',
            'search_items'   => 'Search Artasia Places',
            'not_found'      => 'No Artasia places found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_place',
        'menu_icon'    => 'dashicons-location-alt',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_program_delivery', [
        'labels' => [
            'name'          => 'Artasia Program Deliveries',
            'singular_name' => 'Artasia Program Delivery',
            'add_new_item'  => 'Add New Artasia Program Delivery',
            'edit_item'     => 'Edit Artasia Program Delivery',
            'new_item'      => 'New Artasia Program Delivery',
            'view_item'     => 'View Artasia Program Delivery',
            'search_items'   => 'Search Artasia Program Deliveries',
            'not_found'      => 'No Artasia program deliveries found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_program_delivery',
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
        'edit.php?post_type=artasia_program_delivery',
        '',
        'dashicons-art',
        20
    );

    add_submenu_page(
        'edit.php?post_type=artasia_program_delivery',
        'Artasia Program Deliveries',
        'Program Deliveries',
        'edit_posts',
        'edit.php?post_type=artasia_program_delivery'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_program_delivery',
        'Artasia Places',
        'Places',
        'edit_posts',
        'edit.php?post_type=artasia_place'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_program_delivery',
        'Artasia Partners',
        'Partners',
        'edit_posts',
        'edit.php?post_type=artasia_partner'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_program_delivery',
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
    if (!$screen || !in_array($screen->post_type, ['artasia_program_delivery', 'artasia_place', 'artasia_partner', 'artasia_people'], true)) {
        return $parent_file;
    }

    return 'edit.php?post_type=artasia_program_delivery';
}
add_filter('parent_file', 'artasia_admin_parent_file');

function artasia_admin_submenu_file($submenu_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_program_delivery', 'artasia_place', 'artasia_partner', 'artasia_people'], true)) {
        return $submenu_file;
    }

    return 'edit.php?post_type=' . $screen->post_type;
}
add_filter('submenu_file', 'artasia_admin_submenu_file');
