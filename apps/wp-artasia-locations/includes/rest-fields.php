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

    register_rest_route('artasia/v1', '/projects', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_projects',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('artasia/v1', '/exhibitions', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_exhibitions',
        'permission_callback' => '__return_true',
        'args'                => [
            'project_id' => [
                'type'              => 'integer',
                'required'          => false,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route('artasia/v1', '/supporters', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_supporters',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('artasia/v1', '/recognitions', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_recognitions',
        'permission_callback' => '__return_true',
        'args'                => [
            'project_id' => [
                'type'              => 'integer',
                'required'          => false,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

    register_rest_route('artasia/v1', '/uploaders', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_uploaders',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('artasia/v1', '/activities', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_activities',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('artasia/v1', '/anecdotes', [
        'methods'             => 'GET',
        'callback'            => 'artasia_get_anecdotes',
        'permission_callback' => '__return_true',
        'args'                => [
            'placement_id' => [
                'type'              => 'integer',
                'required'          => false,
                'sanitize_callback' => 'absint',
            ],
        ],
    ]);

});

/**
 * Return the annual Artasia projects that can be selected by the public Atlas
 * viewer. Project visibility is intentionally independent of the placement
 * `artasia_publish_site` flag; that flag is used by WordPress site listings.
 */
function artasia_get_projects(): WP_REST_Response
{
    $projects_query = new WP_Query([
        'post_type'      => 'artasia_project',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => [
            'meta_value_num' => 'DESC',
            'title'          => 'ASC',
        ],
        'meta_key'        => 'artasia_project_year',
        'no_found_rows'   => true,
    ]);

    $results = [];
    foreach ($projects_query->posts as $project) {
        $results[] = [
            'id'          => $project->ID,
            'slug'        => $project->post_name,
            'name'        => $project->post_title,
            'year'        => intval(get_post_meta($project->ID, 'artasia_project_year', true)),
            'tagline'     => get_post_meta($project->ID, 'artasia_project_tagline', true) ?: '',
            'description' => get_post_meta($project->ID, 'artasia_project_description', true) ?: '',
            'statistics'  => artasia_get_project_statistics($project->ID),
        ];
    }

    return rest_ensure_response($results);
}

function artasia_format_exhibition_date_range(string $start_date, string $end_date): string
{
    $timezone = wp_timezone();
    $start = $start_date !== '' ? DateTimeImmutable::createFromFormat('!Y-m-d', $start_date, $timezone) : false;
    $end = $end_date !== '' ? DateTimeImmutable::createFromFormat('!Y-m-d', $end_date, $timezone) : false;

    if (!$start && !$end) {
        return '';
    }
    if (!$start) {
        return wp_date('F j, Y', $end->getTimestamp(), $timezone);
    }
    if (!$end) {
        return wp_date('F j, Y', $start->getTimestamp(), $timezone);
    }
    if ($start->format('Y-m-d') === $end->format('Y-m-d')) {
        return wp_date('F j, Y', $start->getTimestamp(), $timezone);
    }
    if ($start->format('Y-m') === $end->format('Y-m')) {
        return wp_date('F j', $start->getTimestamp(), $timezone) . '–' . wp_date('j, Y', $end->getTimestamp(), $timezone);
    }
    if ($start->format('Y') === $end->format('Y')) {
        return wp_date('F j', $start->getTimestamp(), $timezone) . '–' . wp_date('F j, Y', $end->getTimestamp(), $timezone);
    }

    return wp_date('F j, Y', $start->getTimestamp(), $timezone) . '–' . wp_date('F j, Y', $end->getTimestamp(), $timezone);
}

function artasia_get_exhibitions(WP_REST_Request $request): WP_REST_Response
{
    $project_filter = absint($request->get_param('project_id'));
    $exhibitions = get_posts([
        'post_type'      => 'artasia_exhibition',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'title',
        'order'          => 'ASC',
    ]);
    $results = [];

    foreach ($exhibitions as $exhibition) {
        $project_id = intval(get_post_meta($exhibition->ID, 'artasia_project_id', true));
        if (
            !$project_id
            || get_post_type($project_id) !== 'artasia_project'
            || get_post_status($project_id) !== 'publish'
            || ($project_filter && $project_id !== $project_filter)
        ) {
            continue;
        }

        $start_date = (string) get_post_meta($exhibition->ID, 'artasia_exhibition_start_date', true);
        $end_date = (string) get_post_meta($exhibition->ID, 'artasia_exhibition_end_date', true);
        $host_logo_id = intval(get_post_meta($exhibition->ID, 'artasia_exhibition_host_logo_id', true));
        $host_white_logo_id = intval(get_post_meta($exhibition->ID, 'artasia_exhibition_host_white_logo_id', true));

        $results[] = [
            'id'             => $exhibition->ID,
            'slug'           => $exhibition->post_name,
            'name'           => $exhibition->post_title,
            'project_id'     => $project_id,
            'project_name'   => get_the_title($project_id),
            'description'    => get_post_meta($exhibition->ID, 'artasia_exhibition_description', true) ?: '',
            'host_name'      => get_post_meta($exhibition->ID, 'artasia_exhibition_host_name', true) ?: '',
            'host_url'       => get_post_meta($exhibition->ID, 'artasia_exhibition_host_url', true) ?: '',
            'host_logo'      => artasia_get_partner_logo_response($host_logo_id),
            'host_white_logo' => artasia_get_partner_logo_response($host_white_logo_id),
            'start_date'     => $start_date,
            'end_date'       => $end_date,
            'date_range'     => artasia_format_exhibition_date_range($start_date, $end_date),
        ];
    }

    return rest_ensure_response($results);
}

function artasia_get_supporter_response(WP_Post $supporter): array
{
    $logo_id = intval(get_post_meta($supporter->ID, 'artasia_logo_id', true));
    $white_logo_id = intval(get_post_meta($supporter->ID, 'artasia_white_logo_id', true));

    return [
        'id'             => $supporter->ID,
        'name'           => $supporter->post_title,
        'acronym'        => get_post_meta($supporter->ID, 'artasia_supporter_acronym', true) ?: '',
        'type'           => get_post_meta($supporter->ID, 'artasia_supporter_type', true) ?: '',
        'is_individual'  => (bool) get_post_meta($supporter->ID, 'artasia_supporter_is_individual', true),
        'website'        => get_post_meta($supporter->ID, 'artasia_website', true) ?: '',
        'brand_color_one' => get_post_meta($supporter->ID, 'artasia_brand_color_one', true) ?: '',
        'brand_color_two' => get_post_meta($supporter->ID, 'artasia_brand_color_two', true) ?: '',
        'logo'           => artasia_get_partner_logo_response($logo_id),
        'white_logo'     => artasia_get_partner_logo_response($white_logo_id),
    ];
}

function artasia_get_partner_response(WP_Post $partner): array
{
    $logo_id = intval(get_post_meta($partner->ID, 'artasia_logo_id', true));
    $white_logo_id = intval(get_post_meta($partner->ID, 'artasia_white_logo_id', true));

    return [
        'id'              => $partner->ID,
        'name'            => $partner->post_title,
        'label'           => get_post_meta($partner->ID, 'artasia_partner_label', true) ?: '',
        'acronym'         => get_post_meta($partner->ID, 'artasia_partner_acronym', true) ?: '',
        'type'            => get_post_meta($partner->ID, 'artasia_partner_type', true) ?: '',
        'website'         => get_post_meta($partner->ID, 'artasia_website', true) ?: '',
        'brand_color_one' => get_post_meta($partner->ID, 'artasia_brand_color_one', true) ?: '',
        'brand_color_two' => get_post_meta($partner->ID, 'artasia_brand_color_two', true) ?: '',
        'logo'            => artasia_get_partner_logo_response($logo_id),
        'white_logo'      => artasia_get_partner_logo_response($white_logo_id),
    ];
}

function artasia_get_supporters(): WP_REST_Response
{
    $supporters = get_posts([
        'post_type'   => 'artasia_supporter',
        'numberposts' => -1,
        'post_status' => 'publish',
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);

    return rest_ensure_response(array_map('artasia_get_supporter_response', $supporters));
}

function artasia_get_recognitions(WP_REST_Request $request): WP_REST_Response
{
    $project_filter = absint($request->get_param('project_id'));
    $recognitions = get_posts([
        'post_type'   => 'artasia_recognition',
        'numberposts' => -1,
        'post_status' => 'publish',
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);
    $results = [];

    foreach ($recognitions as $recognition) {
        $project_id = intval(get_post_meta($recognition->ID, 'artasia_project_id', true));
        $supporter_id = intval(get_post_meta($recognition->ID, 'artasia_supporter_id', true));
        $partner_id = intval(get_post_meta($recognition->ID, 'artasia_partner_id', true));
        if (
            !$project_id
            || get_post_type($project_id) !== 'artasia_project'
            || get_post_status($project_id) !== 'publish'
            || (!$supporter_id && !$partner_id)
            || ($supporter_id && (get_post_type($supporter_id) !== 'artasia_supporter' || get_post_status($supporter_id) !== 'publish'))
            || ($partner_id && (get_post_type($partner_id) !== 'artasia_partner' || get_post_status($partner_id) !== 'publish'))
            || ($project_filter && $project_id !== $project_filter)
        ) {
            continue;
        }

        $results[] = [
            'id'            => $recognition->ID,
            'title'         => $recognition->post_title,
            'project_id'    => $project_id,
            'type'          => $partner_id ? 'partner' : 'supporter',
            'partner'       => $partner_id ? artasia_get_partner_response(get_post($partner_id)) : null,
            'supporter'     => $supporter_id ? artasia_get_supporter_response(get_post($supporter_id)) : null,
            'display_order' => max(0, intval(get_post_meta($recognition->ID, 'artasia_recognition_order', true))),
        ];
    }

    usort($results, static function (array $a, array $b): int {
        $order_comparison = $a['display_order'] <=> $b['display_order'];
        if ($order_comparison !== 0) {
            return $order_comparison;
        }

        $a_name = $a['partner']['name'] ?? $a['supporter']['name'] ?? '';
        $b_name = $b['partner']['name'] ?? $b['supporter']['name'] ?? '';

        return strcasecmp($a_name, $b_name);
    });

    return rest_ensure_response($results);
}

function artasia_get_anecdotes(WP_REST_Request $request): WP_REST_Response
{
    $placement_filter = absint($request->get_param('placement_id'));
    $anecdote_query = new WP_Query([
        'post_type'      => 'artasia_anecdote',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => [
            'date'  => 'ASC',
            'title' => 'ASC',
        ],
        'no_found_rows'  => true,
    ]);

    $results = [];
    foreach ($anecdote_query->posts as $anecdote) {
        if (!artasia_anecdote_displays_in_atlas($anecdote->ID)) {
            continue;
        }

        $placement_id = intval(get_post_meta($anecdote->ID, 'artasia_anecdote_placement_id', true));
        if (
            !$placement_id
            || get_post_type($placement_id) !== 'artasia_placement'
            || get_post_status($placement_id) !== 'publish'
        ) {
            continue;
        }
        if ($placement_filter && $placement_id !== $placement_filter) {
            continue;
        }

        $person_id = intval(get_post_meta($anecdote->ID, 'artasia_anecdote_person_id', true));
        $activity_id = intval(get_post_meta($anecdote->ID, 'artasia_anecdote_activity_id', true));
        $person_name = $person_id
            && get_post_type($person_id) === 'artasia_people'
            && get_post_status($person_id) === 'publish'
            ? get_the_title($person_id)
            : '';

        $results[] = [
            'id'            => $anecdote->ID,
            'title'         => $anecdote->post_title,
            'content_html'  => wp_kses_post(apply_filters('the_content', $anecdote->post_content)),
            'placement_id'  => $placement_id,
            'activity_id'   => $activity_id
                && get_post_type($activity_id) === 'artasia_activity'
                && get_post_status($activity_id) === 'publish'
                ? $activity_id
                : null,
            'person'        => $person_name !== ''
                ? [
                    'id'   => $person_id,
                    'name' => $person_name,
                ]
                : null,
            'created_at'    => mysql_to_rfc3339($anecdote->post_date_gmt ?: $anecdote->post_date),
        ];
    }

    return rest_ensure_response($results);
}

function artasia_get_activities(): WP_REST_Response
{
    $activity_query = new WP_Query([
        'post_type'      => 'artasia_activity',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'title',
        'order'          => 'ASC',
    ]);

    $results = [];
    foreach ($activity_query->posts as $activity) {
        $results[] = [
            'id'          => $activity->ID,
            'name'        => $activity->post_title,
            'project_id'  => intval(get_post_meta($activity->ID, 'artasia_project_id', true)),
            'week'        => intval(get_post_meta($activity->ID, 'artasia_activity_week', true)),
            'description' => get_post_meta($activity->ID, 'artasia_activity_description', true) ?: '',
            'colour'      => sanitize_hex_color(get_post_meta($activity->ID, 'artasia_activity_colour', true)) ?: '',
        ];
    }

    return rest_ensure_response($results);
}

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
            'bio'   => get_post_meta($person->ID, 'artasia_bio', true) ?: '',
            'pronouns' => get_post_meta($person->ID, 'artasia_pronouns', true) ?: '',
            'instagram' => get_post_meta($person->ID, 'artasia_instagram', true) ?: '',
            'portfolio_url' => get_post_meta($person->ID, 'artasia_portfolio_url', true) ?: '',
            'publish_profile' => (bool) get_post_meta($person->ID, 'artasia_publish_profile', true),
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
        $secondary_team_member_id = intval(get_post_meta($placement->ID, 'artasia_secondary_team_member_id', true));
        if ($project_id) $project_ids[$project_id] = $project_id;
        if ($vid) $place_ids[$vid] = $vid;
        if ($partner_id) $partner_ids[$partner_id] = $partner_id;
        if ($team_member_id) $team_member_ids[$team_member_id] = $team_member_id;
        if ($secondary_team_member_id) $team_member_ids[$secondary_team_member_id] = $secondary_team_member_id;
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
                'slug'        => $project->post_name,
                'name'        => $project->post_title,
                'year'        => intval(get_post_meta($project->ID, 'artasia_project_year', true)),
                'description' => get_post_meta($project->ID, 'artasia_project_description', true) ?: '',
                'statistics'  => artasia_get_project_statistics($project->ID),
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
            $white_logo_id = intval(get_post_meta($partner->ID, 'artasia_white_logo_id', true));
            $partner_lookup[$partner->ID] = [
                'id'      => $partner->ID,
                'name'    => $partner->post_title,
                'acronym' => get_post_meta($partner->ID, 'artasia_partner_acronym', true) ?: '',
                'type'    => get_post_meta($partner->ID, 'artasia_partner_type', true) ?: '',
                'website' => get_post_meta($partner->ID, 'artasia_website', true) ?: '',
                'brand_color_one' => get_post_meta($partner->ID, 'artasia_brand_color_one', true) ?: '',
                'brand_color_two' => get_post_meta($partner->ID, 'artasia_brand_color_two', true) ?: '',
                'logo'    => artasia_get_partner_logo_response($logo_id),
                'white_logo' => artasia_get_partner_logo_response($white_logo_id),
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
                'bio'   => get_post_meta($person->ID, 'artasia_bio', true) ?: '',
                'pronouns' => get_post_meta($person->ID, 'artasia_pronouns', true) ?: '',
                'instagram' => get_post_meta($person->ID, 'artasia_instagram', true) ?: '',
                'portfolio_url' => get_post_meta($person->ID, 'artasia_portfolio_url', true) ?: '',
                'publish_profile' => (bool) get_post_meta($person->ID, 'artasia_publish_profile', true),
                'photo' => artasia_get_people_photo_response($photo_id),
            ];
        }
    }

    $documentation_lookup = [];
    $documentation_attribution_lookup = [];
    $documentation_posts = get_posts([
        'post_type'      => 'artasia_document',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => [
            'date'  => 'ASC',
            'title' => 'ASC',
        ],
        'no_found_rows'  => true,
    ]);
    foreach ($documentation_posts as $documentation) {
        $documentation_placement_ids = artasia_sanitize_integer_array_meta(
            get_post_meta($documentation->ID, 'artasia_documentation_placement_ids', true)
        );
        $documentation_people_ids = artasia_sanitize_integer_array_meta(
            get_post_meta($documentation->ID, 'artasia_documentation_people_ids', true)
        );
        $documentation_person = isset($documentation_people_ids[0])
            ? get_post($documentation_people_ids[0])
            : null;
        $documentation_attribution = $documentation_person instanceof WP_Post
            && $documentation_person->post_type === 'artasia_people'
            ? $documentation_person->post_title
            : '';
        foreach ($documentation_placement_ids as $documentation_placement_id) {
            if (!isset($documentation_lookup[$documentation_placement_id])) {
                $documentation_lookup[$documentation_placement_id] = $documentation;
                $documentation_attribution_lookup[$documentation_placement_id] = $documentation_attribution;
            }
        }
    }

    $results = [];

    foreach ($placement_posts as $placement) {
        $project_id = intval(get_post_meta($placement->ID, 'artasia_project_id', true));
        $vid = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
        $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
        $team_member_id = intval(get_post_meta($placement->ID, 'artasia_team_member_id', true));
        $secondary_team_member_id = intval(get_post_meta($placement->ID, 'artasia_secondary_team_member_id', true));
        $documentation = $documentation_lookup[$placement->ID] ?? null;
        $documentation_page_id = $project_id
            ? intval(get_post_meta($project_id, 'artasia_documentation_page_id', true))
            : 0;
        $documentation_url = $documentation && $documentation_page_id && get_post_status($documentation_page_id) === 'publish'
            ? add_query_arg('documentation', $documentation->post_name, get_permalink($documentation_page_id))
            : '';
        $documentation_pull_quote = $documentation
            ? trim((string) get_post_meta($documentation->ID, 'artasia_documentation_pull_quote', true))
            : '';
        $documentation_content_html = $documentation
            ? wp_kses_post(apply_filters('the_content', $documentation->post_content))
            : '';

        $results[] = [
            'placement_id' => $placement->ID,
            'placement_name' => $placement->post_title,
            'placement_slug' => $placement->post_name,
            'documentation_url' => $documentation_url,
            'documentation_title' => $documentation ? $documentation->post_title : '',
            'documentation_pull_quote' => $documentation_pull_quote,
            'documentation_content_html' => $documentation_content_html,
            'documentation_attribution' => $documentation_attribution_lookup[$placement->ID] ?? '',
            'project' => $project_lookup[$project_id] ?? null,
            'description' => get_post_meta($placement->ID, 'artasia_placement_description', true) ?: '',
            'program_context' => get_post_meta($placement->ID, 'artasia_program_context', true) ?: '',
            'is_earlyon' => (bool) get_post_meta($placement->ID, 'artasia_is_earlyon', true),
            'section' => get_post_meta($placement->ID, 'artasia_section', true) ?: '',
            'google_drive_folder_id' => get_post_meta($placement->ID, 'artasia_google_drive_folder_id', true) ?: '',
            'delivery_weekday' => get_post_meta($placement->ID, 'artasia_delivery_weekday', true) ?: '',
            'delivery_start_time' => get_post_meta($placement->ID, 'artasia_delivery_start_time', true) ?: '',
            'delivery_end_time' => get_post_meta($placement->ID, 'artasia_delivery_end_time', true) ?: '',
            'delivery_schedule' => artasia_format_placement_schedule($placement->ID),
            'participant_count' => intval(get_post_meta($placement->ID, 'artasia_participant_count', true)),
            'participant_age' => get_post_meta($placement->ID, 'artasia_participant_age', true) ?: '',
            'place'              => $place_lookup[$vid] ?? null,
            'partner'            => $partner_lookup[$partner_id] ?? null,
            'team_member'        => $team_member_lookup[$team_member_id] ?? null,
            'secondary_team_member' => $team_member_lookup[$secondary_team_member_id] ?? null,
        ];
    }

    return rest_ensure_response($results);
}

function artasia_get_project_statistics(int $project_id): array
{
    return [
        'children'          => intval(get_post_meta($project_id, 'artasia_project_children_count', true)),
        'caregivers'        => intval(get_post_meta($project_id, 'artasia_project_caregivers_count', true)),
        'educators'         => intval(get_post_meta($project_id, 'artasia_project_educators_count', true)),
        'artist_educators'  => intval(get_post_meta($project_id, 'artasia_project_artist_educators_count', true)),
        'partners'          => intval(get_post_meta($project_id, 'artasia_project_partners_count', true)),
        'neighbourhoods'    => intval(get_post_meta($project_id, 'artasia_project_neighbourhoods_count', true)),
    ];
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
