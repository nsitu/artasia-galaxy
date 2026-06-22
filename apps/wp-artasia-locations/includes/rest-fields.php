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
    $context_ids  = [];
    $site_posts   = $sites_query->posts;

    foreach ($site_posts as $site) {
        $vid = intval(get_post_meta($site->ID, 'artasia_venue_id', true));
        $cid = intval(get_post_meta($site->ID, 'artasia_context_id', true));
        if ($vid) $venue_ids[$vid] = $vid;
        if ($cid) $context_ids[$cid] = $cid;
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

    $context_lookup = [];
    if (!empty($context_ids)) {
        $context_query = new WP_Query([
            'post_type'      => 'artasia_context',
            'posts_per_page' => -1,
            'post__in'       => array_values($context_ids),
        ]);
        foreach ($context_query->posts as $context) {
            $context_lookup[$context->ID] = [
                'id'      => $context->ID,
                'name'    => $context->post_title,
                'type'    => get_post_meta($context->ID, 'artasia_context_type', true) ?: '',
                'website' => get_post_meta($context->ID, 'artasia_website', true) ?: '',
            ];
        }
    }

    $results = [];

    foreach ($site_posts as $site) {
        $vid = intval(get_post_meta($site->ID, 'artasia_venue_id', true));
        $cid = intval(get_post_meta($site->ID, 'artasia_context_id', true));

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
            'context'            => $context_lookup[$cid] ?? null,
        ];
    }

    return rest_ensure_response($results);
}