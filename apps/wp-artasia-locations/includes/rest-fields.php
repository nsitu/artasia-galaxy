<?php

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('artasia/v1', '/program-deliveries', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_expanded_program_deliveries',
        'permission_callback' => '__return_true',
    ]);
});

function artasia_get_expanded_program_deliveries(): WP_REST_Response
{
    $program_deliveries_query = new WP_Query([
        'post_type'      => 'artasia_program_delivery',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'date',
        'order'          => 'ASC',
    ]);

    $place_ids    = [];
    $partner_ids  = [];
    $lead_ids     = [];
    $program_delivery_posts = $program_deliveries_query->posts;

    foreach ($program_delivery_posts as $program_delivery) {
        $vid = intval(get_post_meta($program_delivery->ID, 'artasia_place_id', true));
        $partner_id = intval(get_post_meta($program_delivery->ID, 'artasia_partner_id', true));
        $lead_id = intval(get_post_meta($program_delivery->ID, 'artasia_lead_id', true));
        if ($vid) $place_ids[$vid] = $vid;
        if ($partner_id) $partner_ids[$partner_id] = $partner_id;
        if ($lead_id) $lead_ids[$lead_id] = $lead_id;
    }

    $place_lookup = [];
    if (!empty($place_ids)) {
        $place_query = new WP_Query([
            'post_type'      => 'artasia_place',
            'posts_per_page' => -1,
            'post__in'       => array_values($place_ids),
        ]);
        foreach ($place_query->posts as $place) {
            $place_lookup[$place->ID] = [
                'id'               => $place->ID,
                'name'             => $place->post_title,
                'address'          => get_post_meta($place->ID, 'artasia_address', true) ?: '',
                'lat'              => floatval(get_post_meta($place->ID, 'artasia_lat', true)),
                'lng'              => floatval(get_post_meta($place->ID, 'artasia_lng', true)),
                'city'             => get_post_meta($place->ID, 'artasia_city', true) ?: '',
                'postal_code'      => get_post_meta($place->ID, 'artasia_postal_code', true) ?: '',
                'accessibility_notes' => get_post_meta($place->ID, 'artasia_accessibility_notes', true) ?: '',
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

    $lead_lookup = [];
    if (!empty($lead_ids)) {
        $lead_query = new WP_Query([
            'post_type'      => 'artasia_people',
            'posts_per_page' => -1,
            'post__in'       => array_values($lead_ids),
        ]);
        foreach ($lead_query->posts as $person) {
            $photo_id = intval(get_post_meta($person->ID, 'artasia_photo_id', true));
            $lead_lookup[$person->ID] = [
                'id'    => $person->ID,
                'name'  => $person->post_title,
                'role'  => get_post_meta($person->ID, 'artasia_role', true) ?: 'Artist Educator',
                'photo' => artasia_get_people_photo_response($photo_id),
            ];
        }
    }

    $results = [];

    foreach ($program_delivery_posts as $program_delivery) {
        $vid = intval(get_post_meta($program_delivery->ID, 'artasia_place_id', true));
        $partner_id = intval(get_post_meta($program_delivery->ID, 'artasia_partner_id', true));
        $lead_id = intval(get_post_meta($program_delivery->ID, 'artasia_lead_id', true));

        $results[] = [
            'program_delivery_id' => $program_delivery->ID,
            'program_delivery_name' => $program_delivery->post_title,
            'program_year' => intval(get_post_meta($program_delivery->ID, 'artasia_program_year', true)),
            'program_context' => get_post_meta($program_delivery->ID, 'artasia_program_context', true) ?: '',
            'is_earlyon' => (bool) get_post_meta($program_delivery->ID, 'artasia_is_earlyon', true),
            'section' => get_post_meta($program_delivery->ID, 'artasia_section', true) ?: '',
            'participant_count' => intval(get_post_meta($program_delivery->ID, 'artasia_participant_count', true)),
            'participant_age' => get_post_meta($program_delivery->ID, 'artasia_participant_age', true) ?: '',
            'place'              => $place_lookup[$vid] ?? null,
            'partner'            => $partner_lookup[$partner_id] ?? null,
            'lead'               => $lead_lookup[$lead_id] ?? null,
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

function artasia_get_people_photo_response(int $attachment_id): ?array
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
