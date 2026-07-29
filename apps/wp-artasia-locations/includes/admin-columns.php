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
            $new['artasia_team_member'] = 'Lead Team Member';
            $new['artasia_secondary_team_member'] = 'Secondary Team Member';
            $new['artasia_program_context'] = 'Program / Context';
            $new['artasia_is_earlyon'] = 'EarlyON';
            $new['artasia_section']  = 'Section';
            $new['artasia_delivery_schedule'] = 'Schedule';
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
        case 'artasia_team_member':
            $team_member_id = intval(get_post_meta($post_id, 'artasia_team_member_id', true));
            echo $team_member_id ? esc_html(get_the_title($team_member_id)) : '—';
            break;
        case 'artasia_secondary_team_member':
            $secondary_team_member_id = intval(get_post_meta($post_id, 'artasia_secondary_team_member_id', true));
            echo $secondary_team_member_id ? esc_html(get_the_title($secondary_team_member_id)) : '-';
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
        case 'artasia_delivery_schedule':
            echo esc_html(artasia_format_placement_schedule($post_id) ?: '-');
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
            $new['artasia_project_activities'] = 'Activities';
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
        case 'artasia_project_activities':
            $activities = get_posts([
                'post_type'   => 'artasia_activity',
                'numberposts' => -1,
                'meta_key'    => 'artasia_project_id',
                'meta_value'  => $post_id,
                'fields'      => 'ids',
            ]);
            echo esc_html((string) count($activities));
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

// --- Activity columns ---

function artasia_activity_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_project'] = 'Project';
            $new['artasia_activity_week'] = 'Program Week';
        }
    }
    return $new;
}
add_filter('manage_artasia_activity_posts_columns', 'artasia_activity_columns');

function artasia_activity_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_project':
            $project_id = intval(get_post_meta($post_id, 'artasia_project_id', true));
            echo $project_id ? esc_html(artasia_project_admin_label($project_id)) : '-';
            break;
        case 'artasia_activity_week':
            $week = intval(get_post_meta($post_id, 'artasia_activity_week', true));
            echo $week ? esc_html((string) $week) : '-';
            break;
    }
}
add_action('manage_artasia_activity_posts_custom_column', 'artasia_activity_column', 10, 2);

// --- Place columns ---

function artasia_place_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_address'] = 'Address';
            $new['artasia_city']    = 'City';
            $new['artasia_shared_with'] = 'Shared With';
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
        case 'artasia_shared_with':
            echo esc_html(get_post_meta($post_id, 'artasia_shared_with', true) ?: '—');
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
            $new['artasia_logo'] = 'Logo';
            $new['artasia_white_logo'] = 'White Logo';
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
        case 'artasia_logo':
            $logo_id = intval(get_post_meta($post_id, 'artasia_logo_id', true));
            if ($logo_id) {
                $logo = wp_get_attachment_image($logo_id, [200, 150], false, ['class' => 'artasia-admin-logo']);
                if ($logo) {
                    echo '<div class="artasia-admin-logo-wrapper">' . $logo . '</div>';
                    break;
                }
            }
            echo '—';
            break;
        case 'artasia_white_logo':
            $logo_id = intval(get_post_meta($post_id, 'artasia_white_logo_id', true));
            if ($logo_id) {
                $logo = wp_get_attachment_image($logo_id, [200, 150], false, ['class' => 'artasia-admin-logo']);
                if ($logo) {
                    echo '<div class="artasia-admin-logo-wrapper artasia-admin-logo-wrapper--dark">' . $logo . '</div>';
                    break;
                }
            }
            echo '&mdash;';
            break;
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
            $new['artasia_email'] = 'Email';
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
        case 'artasia_email':
            $email = get_post_meta($post_id, 'artasia_email', true);
            echo $email ? '<a href="mailto:' . esc_attr($email) . '">' . esc_html($email) . '</a>' : '—';
            break;
        case 'artasia_photo':
            $photo_id = intval(get_post_meta($post_id, 'artasia_photo_id', true));
            echo $photo_id ? wp_get_attachment_image($photo_id, 'thumbnail', false, ['style' => 'max-width:48px;height:auto;']) : '—';
            break;
        case 'artasia_assigned_placements':
            $placements = get_posts([
                'post_type'   => 'artasia_placement',
                'numberposts' => -1,
                'meta_query'  => [
                    'relation' => 'OR',
                    [
                        'key'   => 'artasia_team_member_id',
                        'value' => $post_id,
                    ],
                    [
                        'key'   => 'artasia_secondary_team_member_id',
                        'value' => $post_id,
                    ],
                ],
                'fields'      => 'ids',
            ]);

            echo esc_html((string) count($placements));
            break;
    }
}
add_action('manage_artasia_people_posts_custom_column', 'artasia_people_column', 10, 2);

// --- Artasia Role columns ---

function artasia_role_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_role_person'] = 'Person';
            $new['artasia_role_project'] = 'Project';
            $new['artasia_role_order'] = 'Display Order';
        }
    }

    return $new;
}
add_filter('manage_artasia_role_posts_columns', 'artasia_role_columns');

function artasia_role_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_role_person':
            $person_id = intval(get_post_meta($post_id, 'artasia_person_id', true));
            echo $person_id ? esc_html(get_the_title($person_id)) : '—';
            break;
        case 'artasia_role_project':
            $project_id = intval(get_post_meta($post_id, 'artasia_project_id', true));
            echo $project_id ? esc_html(artasia_project_admin_label($project_id)) : '—';
            break;
        case 'artasia_role_order':
            echo esc_html((string) intval(get_post_meta($post_id, 'artasia_role_order', true)));
            break;
    }
}
add_action('manage_artasia_role_posts_custom_column', 'artasia_role_column', 10, 2);

// --- Pedagogical Documentation columns ---

function artasia_documentation_columns(array $columns): array
{
    $new = [];
    foreach ($columns as $key => $label) {
        $new[$key] = $label;
        if ($key === 'title') {
            $new['artasia_documentation_people'] = 'People';
            $new['artasia_documentation_placements'] = 'Placements';
            $new['artasia_documentation_pull_quote'] = 'Pull Quote';
        }
    }

    return $new;
}
add_filter('manage_artasia_document_posts_columns', 'artasia_documentation_columns');

function artasia_documentation_related_titles(int $post_id, string $meta_key): string
{
    $ids = artasia_sanitize_integer_array_meta(get_post_meta($post_id, $meta_key, true));
    $titles = array_filter(array_map('get_the_title', $ids));

    return implode(', ', $titles);
}

function artasia_documentation_column(string $column, int $post_id): void
{
    switch ($column) {
        case 'artasia_documentation_people':
            echo esc_html(artasia_documentation_related_titles($post_id, 'artasia_documentation_people_ids') ?: '—');
            break;
        case 'artasia_documentation_placements':
            echo esc_html(artasia_documentation_related_titles($post_id, 'artasia_documentation_placement_ids') ?: '—');
            break;
        case 'artasia_documentation_pull_quote':
            $pull_quote = get_post_meta($post_id, 'artasia_documentation_pull_quote', true);
            echo esc_html($pull_quote ? wp_trim_words($pull_quote, 18, '…') : '—');
            break;
    }
}
add_action('manage_artasia_document_posts_custom_column', 'artasia_documentation_column', 10, 2);
