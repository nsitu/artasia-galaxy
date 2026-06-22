<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_post_types(): void
{
    register_post_type('artasia_venue', [
        'labels' => [
            'name'          => 'Venues',
            'singular_name' => 'Venue',
            'add_new_item'  => 'Add New Venue',
            'edit_item'     => 'Edit Venue',
            'new_item'      => 'New Venue',
            'view_item'     => 'View Venue',
            'search_items'   => 'Search Venues',
            'not_found'      => 'No venues found',
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
            'name'          => 'Sites',
            'singular_name' => 'Site',
            'add_new_item'  => 'Add New Site',
            'edit_item'     => 'Edit Site',
            'new_item'      => 'New Site',
            'view_item'     => 'View Site',
            'search_items'   => 'Search Sites',
            'not_found'      => 'No sites found',
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