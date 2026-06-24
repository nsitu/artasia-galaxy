<?php

if (!defined('ABSPATH')) {
    exit;
}

// --- Site columns ---

function artasia_site_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_venue']    = 'Venue';
            $new['artasia_partner']  = 'Artasia Partner';
            $new['artasia_year']     = 'Year';
            $new['artasia_program_context'] = 'Program / Context';
            $new['artasia_is_earlyon'] = 'EarlyON';
            $new['artasia_section']  = 'Section';
            $new['artasia_participants'] = 'Participants';
        }
    }
    return $new;
}
add_filter('manage_artasia_site_posts_columns', 'artasia_site_columns');

function artasia_site_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_venue':
            $vid = intval(get_post_meta($post_id, 'artasia_venue_id', true));
            echo $vid ? esc_html(get_the_title($vid)) : '—';
            break;
        case 'artasia_partner':
            $partner_id = intval(get_post_meta($post_id, 'artasia_partner_id', true));
            echo $partner_id ? esc_html(get_the_title($partner_id)) : '—';
            break;
        case 'artasia_year':
            echo esc_html(get_post_meta($post_id, 'artasia_program_year', true) ?: '—');
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
add_action('manage_artasia_site_posts_custom_column', 'artasia_site_column', 10, 2);

// --- Venue columns ---

function artasia_venue_columns(array $columns): array
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
add_filter('manage_artasia_venue_posts_columns', 'artasia_venue_columns');

function artasia_venue_column(string $column, int $post_id): void
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
add_action('manage_artasia_venue_posts_custom_column', 'artasia_venue_column', 10, 2);

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
