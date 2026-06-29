<?php

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('artasia/v1', '/placements', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_expanded_placements',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('artasia/v1', '/uploaders', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_uploaders',
        'permission_callback' => '__return_true',
    ]);
});

function artasia_get_uploaders(): WP_REST_Response
{
    $people_query = new WP_Query([
        'post_type'      => 'artasia_people',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'title',
        'order'          => 'ASC',
    ]);

    $results = [];
    foreach ($people_query->posts as $person) {
        $results[] = [
            'id'    => $person->ID,
            'name'  => $person->post_title,
            'role'  => get_post_meta($person->ID, 'artasia_role', true) ?: 'Artist Educator',
            'email' => get_post_meta($person->ID, 'artasia_email', true) ?: '',
        ];
    }

    return rest_ensure_response($results);
}

function artasia_get_expanded_placements(): WP_REST_Response
{
    $placements_query = new WP_Query([
        'post_type'      => 'artasia_placement',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'date',
        'order'          => 'ASC',
    ]);

    $place_ids    = [];
    $partner_ids  = [];
    $team_member_ids = [];
    $placement_posts = $placements_query->posts;

    $project_ids  = [];
    foreach ($placement_posts as $placement) {
        $project_id = intval(get_post_meta($placement->ID, 'artasia_project_id', true));
        $vid = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
        $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
        $team_member_id = intval(get_post_meta($placement->ID, 'artasia_team_member_id', true));
        if ($project_id) $project_ids[$project_id] = $project_id;
        if ($vid) $place_ids[$vid] = $vid;
        if ($partner_id) $partner_ids[$partner_id] = $partner_id;
        if ($team_member_id) $team_member_ids[$team_member_id] = $team_member_id;
    }

    $project_lookup = [];
    if (!empty($project_ids)) {
        $project_query = new WP_Query([
            'post_type'      => 'artasia_project',
            'posts_per_page' => -1,
            'post__in'       => array_values($project_ids),
        ]);
        foreach ($project_query->posts as $project) {
            $project_lookup[$project->ID] = [
                'id'          => $project->ID,
                'name'        => $project->post_title,
                'year'        => intval(get_post_meta($project->ID, 'artasia_project_year', true)),
                'description' => get_post_meta($project->ID, 'artasia_project_description', true) ?: '',
            ];
        }
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
                'shared_with'      => get_post_meta($place->ID, 'artasia_shared_with', true) ?: '',
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

    $team_member_lookup = [];
    if (!empty($team_member_ids)) {
        $team_member_query = new WP_Query([
            'post_type'      => 'artasia_people',
            'posts_per_page' => -1,
            'post__in'       => array_values($team_member_ids),
        ]);
        foreach ($team_member_query->posts as $person) {
            $photo_id = intval(get_post_meta($person->ID, 'artasia_photo_id', true));
            $team_member_lookup[$person->ID] = [
                'id'    => $person->ID,
                'name'  => $person->post_title,
                'role'  => get_post_meta($person->ID, 'artasia_role', true) ?: 'Artist Educator',
                'email' => get_post_meta($person->ID, 'artasia_email', true) ?: '',
                'photo' => artasia_get_people_photo_response($photo_id),
            ];
        }
    }

    $results = [];

    foreach ($placement_posts as $placement) {
        $project_id = intval(get_post_meta($placement->ID, 'artasia_project_id', true));
        $vid = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
        $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
        $team_member_id = intval(get_post_meta($placement->ID, 'artasia_team_member_id', true));

        $results[] = [
            'placement_id' => $placement->ID,
            'placement_name' => $placement->post_title,
            'project' => $project_lookup[$project_id] ?? null,
            'program_context' => get_post_meta($placement->ID, 'artasia_program_context', true) ?: '',
            'is_earlyon' => (bool) get_post_meta($placement->ID, 'artasia_is_earlyon', true),
            'section' => get_post_meta($placement->ID, 'artasia_section', true) ?: '',
            'delivery_weekday' => get_post_meta($placement->ID, 'artasia_delivery_weekday', true) ?: '',
            'delivery_start_time' => get_post_meta($placement->ID, 'artasia_delivery_start_time', true) ?: '',
            'delivery_end_time' => get_post_meta($placement->ID, 'artasia_delivery_end_time', true) ?: '',
            'delivery_schedule' => artasia_format_placement_schedule($placement->ID),
            'participant_count' => intval(get_post_meta($placement->ID, 'artasia_participant_count', true)),
            'participant_age' => get_post_meta($placement->ID, 'artasia_participant_age', true) ?: '',
            'place'              => $place_lookup[$vid] ?? null,
            'partner'            => $partner_lookup[$partner_id] ?? null,
            'team_member'        => $team_member_lookup[$team_member_id] ?? null,
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
