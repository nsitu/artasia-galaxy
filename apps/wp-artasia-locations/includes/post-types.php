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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_project',
        'menu_icon'    => 'dashicons-calendar-alt',
        'supports'     => ['title'],
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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
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
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'has_archive'  => false,
        'rewrite'      => false,
        'query_var'    => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_people',
        'menu_icon'    => 'dashicons-id-alt',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_role', [
        'labels' => [
            'name'          => 'Artasia Roles',
            'singular_name' => 'Artasia Role',
            'add_new_item'  => 'Add New Artasia Role',
            'edit_item'     => 'Edit Artasia Role',
            'new_item'      => 'New Artasia Role',
            'view_item'     => 'View Artasia Role',
            'search_items'  => 'Search Artasia Roles',
            'not_found'     => 'No Artasia roles found',
        ],
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'rewrite'      => false,
        'query_var'    => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_role',
        'menu_icon'    => 'dashicons-businessperson',
        'supports'     => ['title'],
    ]);

    register_post_type('artasia_document', [
        'labels' => [
            'name'          => 'Documentation',
            'singular_name' => 'Documentation',
            'add_new_item'  => 'Add New Documentation',
            'edit_item'     => 'Edit Documentation',
            'new_item'      => 'New Documentation',
            'view_item'     => 'View Documentation',
            'search_items'  => 'Search Documentation',
            'not_found'     => 'No documentation found',
        ],
        'public'       => false,
        'publicly_queryable' => false,
        'show_ui'      => true,
        'exclude_from_search' => true,
        'rewrite'      => false,
        'query_var'    => false,
        'has_archive'  => false,
        'show_in_menu' => false,
        'show_in_rest' => true,
        'rest_base'    => 'artasia_documentation',
        'menu_icon'    => 'dashicons-welcome-write-blog',
        'supports'     => ['title', 'editor', 'author', 'revisions'],
    ]);

    register_post_type('artasia_anecdote', [
        'labels' => [
            'name'          => 'Learning Anecdotes',
            'singular_name' => 'Learning Anecdote',
            'add_new_item'  => 'Add New Learning Anecdote',
            'edit_item'     => 'Edit Learning Anecdote',
            'new_item'      => 'New Learning Anecdote',
            'view_item'     => 'View Learning Anecdote',
            'search_items'  => 'Search Learning Anecdotes',
            'not_found'     => 'No learning anecdotes found',
        ],
        'public'              => false,
        'publicly_queryable'  => false,
        'show_ui'             => true,
        'exclude_from_search' => true,
        'rewrite'             => false,
        'query_var'           => false,
        'has_archive'         => false,
        'show_in_menu'        => false,
        'show_in_rest'        => true,
        'rest_base'           => 'artasia_anecdotes',
        'menu_icon'           => 'dashicons-format-quote',
        'supports'            => ['title', 'editor', 'revisions'],
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
        'Artasia Roles',
        'Roles',
        'edit_posts',
        'edit.php?post_type=artasia_role'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Placements',
        'Placements',
        'edit_posts',
        'edit.php?post_type=artasia_placement'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Pedagogical Documentation',
        'Documentation',
        'edit_posts',
        'edit.php?post_type=artasia_document'
    );

    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Learning Anecdotes',
        'Anecdotes',
        'edit_posts',
        'edit.php?post_type=artasia_anecdote'
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
    if (!$screen || !in_array($screen->post_type, ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_role', 'artasia_placement', 'artasia_document', 'artasia_anecdote'], true)) {
        return $parent_file;
    }

    return 'edit.php?post_type=artasia_placement';
}
add_filter('parent_file', 'artasia_admin_parent_file');

function artasia_admin_submenu_file($submenu_file)
{
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_role', 'artasia_placement', 'artasia_document', 'artasia_anecdote'], true)) {
        return $submenu_file;
    }

    return 'edit.php?post_type=' . $screen->post_type;
}
add_filter('submenu_file', 'artasia_admin_submenu_file');

function artasia_use_block_editor_for_post_type(bool $use_block_editor, string $post_type): bool
{
    $artasia_post_types = ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_role', 'artasia_placement', 'artasia_document', 'artasia_anecdote'];

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

    if ($post->post_type === 'artasia_document') {
        return 'Add documentation title';
    }

    if ($post->post_type === 'artasia_anecdote') {
        return 'Add a short anecdote title';
    }

    if ($post->post_type === 'artasia_role') {
        return 'Add responsibility (for example, Program Coordinator)';
    }

    return $title;
}
add_filter('enter_title_here', 'artasia_enter_title_here', 10, 2);
