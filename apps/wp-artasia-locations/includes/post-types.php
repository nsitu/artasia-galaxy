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

    register_post_type('artasia_context', [
        'labels' => [
            'name'          => 'Contexts',
            'singular_name' => 'Context',
            'add_new_item'  => 'Add New Context',
            'edit_item'     => 'Edit Context',
            'new_item'      => 'New Context',
            'view_item'     => 'View Context',
            'search_items'   => 'Search Contexts',
            'not_found'      => 'No contexts found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_context',
        'menu_icon'    => 'dashicons-groups',
        'supports'     => ['title'],
    ]);
}

add_action('init', 'artasia_register_post_types');
