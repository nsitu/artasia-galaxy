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

    register_post_type('artasia_placement', [
        'labels' => [
            'name'          => 'Artasia Placements',
            'singular_name' => 'Artasia Placement',
            'add_new_item'  => 'Add New Artasia Placement',
            'edit_item'     => 'Edit Artasia Placement',
            'new_item'      => 'New Artasia Placement',
            'view_item'     => 'View Artasia Placement',
            'search_items'   => 'Search Artasia Placements',
            'not_found'      => 'No Artasia placements found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_placement',
        'menu_icon'    => 'dashicons-art',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_project', [
        'labels' => [
            'name'          => 'Artasia Projects',
            'singular_name' => 'Artasia Project',
            'add_new_item'  => 'Add New Artasia Project',
            'edit_item'     => 'Edit Artasia Project',
            'new_item'      => 'New Artasia Project',
            'view_item'     => 'View Artasia Project',
            'search_items'  => 'Search Artasia Projects',
            'not_found'     => 'No Artasia projects found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_project',
        'menu_icon'    => 'dashicons-calendar-alt',
        'supports'     => ['title'],
        'taxonomies'   => ['post_tag'],
    ]);

    register_post_type('artasia_activity', [
        'labels' => [
            'name'          => 'Artasia Activities',
            'singular_name' => 'Artasia Activity',
            'add_new_item'  => 'Add New Artasia Activity',
            'edit_item'     => 'Edit Artasia Activity',
            'new_item'      => 'New Artasia Activity',
            'view_item'     => 'View Artasia Activity',
            'search_items'  => 'Search Artasia Activities',
            'not_found'     => 'No Artasia activities found',
        ],
        'public'       => true,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_activity',
        'menu_icon'    => 'dashicons-clipboard',
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

function artasia_remove_placement_editor_support(): void
{
    remove_post_type_support('artasia_placement', 'editor');
}
add_action('init', 'artasia_remove_placement_editor_support', 11);

function artasia_register_admin_menu(): void
{
    add_menu_page(
        'Artasia',
        'Artasia',
        'edit_posts',
        'edit.php?post_type=artasia_placement',
        '',
        'dashicons-art',
        20
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Projects',
        'Projects',
        'edit_posts',
        'edit.php?post_type=artasia_project'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Activities',
        'Activities',
        'edit_posts',
        'edit.php?post_type=artasia_activity'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Partners',
        'Partners',
        'edit_posts',
        'edit.php?post_type=artasia_partner'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Places',
        'Places',
        'edit_posts',
        'edit.php?post_type=artasia_place'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia People',
        'People',
        'edit_posts',
        'edit.php?post_type=artasia_people'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Placements',
        'Placements',
        'edit_posts',
        'edit.php?post_type=artasia_placement'
    );

    remove_submenu_page(
        'edit.php?post_type=artasia_placement',
        'edit.php?post_type=artasia_placement'
    );
}
add_action('admin_menu', 'artasia_register_admin_menu');

function artasia_admin_parent_file($parent_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_placement'], true)) {
        return $parent_file;
    }

    return 'edit.php?post_type=artasia_placement';
}
add_filter('parent_file', 'artasia_admin_parent_file');

function artasia_admin_submenu_file($submenu_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_placement'], true)) {
        return $submenu_file;
    }

    return 'edit.php?post_type=' . $screen->post_type;
}
add_filter('submenu_file', 'artasia_admin_submenu_file');

function artasia_use_block_editor_for_post_type(bool $use_block_editor, string $post_type): bool
{
    $artasia_post_types = ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_placement'];

    if (in_array($post_type, $artasia_post_types, true)) {
        return false;
    }

    return $use_block_editor;
}
add_filter('use_block_editor_for_post_type', 'artasia_use_block_editor_for_post_type', 10, 2);

function artasia_enter_title_here(string $title, WP_Post $post): string
{
    if ($post->post_type === 'artasia_placement') {
        return 'Add short placement name';
    }

    if ($post->post_type === 'artasia_activity') {
        return 'Add activity name';
    }

    return $title;
}
add_filter('enter_title_here', 'artasia_enter_title_here', 10, 2);
