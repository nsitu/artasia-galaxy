<?php

if (!defined('ABSPATH')) {
    exit;
}

// --- Placement columns ---

function artasia_placement_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_project']  = 'Project';
            $new['artasia_place']    = 'Place';
            $new['artasia_partner']  = 'Artasia Partner';
            $new['artasia_lead']     = 'Artasia Lead';
            $new['artasia_program_context'] = 'Program / Context';
            $new['artasia_is_earlyon'] = 'EarlyON';
            $new['artasia_section']  = 'Section';
            $new['artasia_participants'] = 'Participants';
        }
    }
    return $new;
}
add_filter('manage_artasia_placement_posts_columns', 'artasia_placement_columns');

function artasia_placement_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_project':
            $project_id = intval(get_post_meta($post_id, 'artasia_project_id', true));
            echo $project_id ? esc_html(artasia_project_admin_label($project_id)) : '—';
            break;
        case 'artasia_place':
            $vid = intval(get_post_meta($post_id, 'artasia_place_id', true));
            echo $vid ? esc_html(get_the_title($vid)) : '—';
            break;
        case 'artasia_partner':
            $partner_id = intval(get_post_meta($post_id, 'artasia_partner_id', true));
            echo $partner_id ? esc_html(get_the_title($partner_id)) : '—';
            break;
        case 'artasia_lead':
            $lead_id = intval(get_post_meta($post_id, 'artasia_lead_id', true));
            echo $lead_id ? esc_html(get_the_title($lead_id)) : '—';
            break;
        case 'artasia_program_context':
            echo esc_html(get_post_meta($post_id, 'artasia_program_context', true) ?: '—');
            break;
        case 'artasia_is_earlyon':
            echo get_post_meta($post_id, 'artasia_is_earlyon', true) ? 'Yes' : '—';
            break;
        case 'artasia_section':
            echo esc_html(get_post_meta($post_id, 'artasia_section', true) ?: '—');
            break;
        case 'artasia_participants':
            echo esc_html(get_post_meta($post_id, 'artasia_participant_count', true) ?: '—');
            break;
    }
}
add_action('manage_artasia_placement_posts_custom_column', 'artasia_placement_column', 10, 2);

// --- Project columns ---

function artasia_project_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_project_year'] = 'Year';
            $new['artasia_project_deliveries'] = 'Placements';
        }
    }
    return $new;
}
add_filter('manage_artasia_project_posts_columns', 'artasia_project_columns');

function artasia_project_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_project_year':
            echo esc_html(get_post_meta($post_id, 'artasia_project_year', true) ?: '—');
            break;
        case 'artasia_project_deliveries':
            $placements = get_posts([
                'post_type'   => 'artasia_placement',
                'numberposts' => -1,
                'meta_key'    => 'artasia_project_id',
                'meta_value'  => $post_id,
                'fields'      => 'ids',
            ]);
            echo esc_html((string) count($placements));
            break;
    }
}
add_action('manage_artasia_project_posts_custom_column', 'artasia_project_column', 10, 2);

function artasia_project_admin_label(int $project_id): string
{
    $title = get_the_title($project_id);
    $year = get_post_meta($project_id, 'artasia_project_year', true);

    return trim($year . ' - ' . $title, ' -');
}

// --- Place columns ---

function artasia_place_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_address'] = 'Address';
            $new['artasia_city']    = 'City';
        }
    }
    return $new;
}
add_filter('manage_artasia_place_posts_columns', 'artasia_place_columns');

function artasia_place_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_address':
            echo esc_html(get_post_meta($post_id, 'artasia_address', true) ?: '—');
            break;
        case 'artasia_city':
            echo esc_html(get_post_meta($post_id, 'artasia_city', true) ?: '—');
            break;
    }
}
add_action('manage_artasia_place_posts_custom_column', 'artasia_place_column', 10, 2);

// --- Artasia Partner columns ---

function artasia_partner_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_partner_type'] = 'Type';
            $new['artasia_website']       = 'Website';
        }
    }
    return $new;
}
add_filter('manage_artasia_partner_posts_columns', 'artasia_partner_columns');

function artasia_partner_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_partner_type':
            echo esc_html(get_post_meta($post_id, 'artasia_partner_type', true) ?: '—');
            break;
        case 'artasia_website':
            $url = get_post_meta($post_id, 'artasia_website', true);
            echo $url ? '<a href="' . esc_url($url) . '" target="_blank">' . esc_html($url) . '</a>' : '—';
            break;
    }
}
add_action('manage_artasia_partner_posts_custom_column', 'artasia_partner_column', 10, 2);

// --- Artasia People columns ---

function artasia_people_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_role'] = 'Role';
            $new['artasia_photo'] = 'Photo';
            $new['artasia_assigned_placements'] = 'Assigned Placements';
        }
    }
    return $new;
}
add_filter('manage_artasia_people_posts_columns', 'artasia_people_columns');

function artasia_people_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_role':
            echo esc_html(get_post_meta($post_id, 'artasia_role', true) ?: 'Artist Educator');
            break;
        case 'artasia_photo':
            $photo_id = intval(get_post_meta($post_id, 'artasia_photo_id', true));
            echo $photo_id ? wp_get_attachment_image($photo_id, 'thumbnail', false, ['style' => 'max-width:48px;height:auto;']) : '—';
            break;
        case 'artasia_assigned_placements':
            $placements = get_posts([
                'post_type'   => 'artasia_placement',
                'numberposts' => -1,
                'meta_key'    => 'artasia_lead_id',
                'meta_value'  => $post_id,
                'fields'      => 'ids',
            ]);

            echo esc_html((string) count($placements));
            break;
    }
}
add_action('manage_artasia_people_posts_custom_column', 'artasia_people_column', 10, 2);
