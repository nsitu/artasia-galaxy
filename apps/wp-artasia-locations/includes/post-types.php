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
        'show_in_rest' => true,
        'rest_base'    => 'artasia_people',
        'menu_icon'    => 'dashicons-id-alt',
        'supports'     => ['title'],
    ]);
}

add_action('init', 'artasia_register_post_types');
