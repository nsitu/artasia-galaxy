<?php

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('artasia/v1', '/locations', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_expanded_locations',
        'permission_callback' => '__return_true',
    ]);
});

function artasia_get_expanded_locations(): WP_REST_Response
{
    $sites_query = new WP_Query([
        'post_type'      => 'artasia_site',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'date',
        'order'          => 'ASC',
    ]);

    $venue_ids    = [];
    $partner_ids  = [];
    $site_posts   = $sites_query->posts;

    foreach ($site_posts as $site) {
        $vid = intval(get_post_meta($site->ID, 'artasia_venue_id', true));
        $partner_id = intval(get_post_meta($site->ID, 'artasia_partner_id', true));
        if ($vid) $venue_ids[$vid] = $vid;
        if ($partner_id) $partner_ids[$partner_id] = $partner_id;
    }

    $venue_lookup = [];
    if (!empty($venue_ids)) {
        $venue_query = new WP_Query([
            'post_type'      => 'artasia_venue',
            'posts_per_page' => -1,
            'post__in'       => array_values($venue_ids),
        ]);
        foreach ($venue_query->posts as $venue) {
            $venue_lookup[$venue->ID] = [
                'id'               => $venue->ID,
                'name'             => $venue->post_title,
                'address'          => get_post_meta($venue->ID, 'artasia_address', true) ?: '',
                'lat'              => floatval(get_post_meta($venue->ID, 'artasia_lat', true)),
                'lng'              => floatval(get_post_meta($venue->ID, 'artasia_lng', true)),
                'city'             => get_post_meta($venue->ID, 'artasia_city', true) ?: '',
                'postal_code'      => get_post_meta($venue->ID, 'artasia_postal_code', true) ?: '',
                'accessibility_notes' => get_post_meta($venue->ID, 'artasia_accessibility_notes', true) ?: '',
            ];
        }
    }

    $partner_lookup = [];
    if (!empty($partner_ids)) {
        $partner_query = new WP_Query([
            'post_type'      => 'artasia_partner',
            'posts_per_page' => -1,
            'post__in'       => array_values($partner_ids),
        ]);
        foreach ($partner_query->posts as $partner) {
            $logo_id = intval(get_post_meta($partner->ID, 'artasia_logo_id', true));
            $partner_lookup[$partner->ID] = [
                'id'      => $partner->ID,
                'name'    => $partner->post_title,
                'type'    => get_post_meta($partner->ID, 'artasia_partner_type', true) ?: '',
                'website' => get_post_meta($partner->ID, 'artasia_website', true) ?: '',
                'logo'    => artasia_get_partner_logo_response($logo_id),
            ];
        }
    }

    $results = [];

    foreach ($site_posts as $site) {
        $vid = intval(get_post_meta($site->ID, 'artasia_venue_id', true));
        $partner_id = intval(get_post_meta($site->ID, 'artasia_partner_id', true));

        $results[] = [
            'site_id'            => $site->ID,
            'site_name'          => $site->post_title,
            'program_year'       => intval(get_post_meta($site->ID, 'artasia_program_year', true)),
            'section'            => get_post_meta($site->ID, 'artasia_section', true) ?: '',
            'participant_count'  => intval(get_post_meta($site->ID, 'artasia_participant_count', true)),
            'participant_age'    => get_post_meta($site->ID, 'artasia_participant_age', true) ?: '',
            'start_date'         => get_post_meta($site->ID, 'artasia_start_date', true) ?: '',
            'end_date'           => get_post_meta($site->ID, 'artasia_end_date', true) ?: '',
            'venue'              => $venue_lookup[$vid] ?? null,
            'partner'            => $partner_lookup[$partner_id] ?? null,
        ];
    }

    return rest_ensure_response($results);
}

function artasia_get_partner_logo_response(int $attachment_id): ?array
{
    if (!$attachment_id) {
        return null;
    }

    $url = wp_get_attachment_url($attachment_id);
    if (!$url) {
        return null;
    }

    return [
        'id'        => $attachment_id,
        'url'       => $url,
        'mime_type' => get_post_mime_type($attachment_id) ?: '',
        'alt'       => get_post_meta($attachment_id, '_wp_attachment_image_alt', true) ?: '',
    ];
}
