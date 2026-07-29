<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_meta_fields(): void
{
    // --- Place meta ---
    register_post_meta('artasia_place', 'artasia_address', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_place', 'artasia_lat', [
        'type'         => 'number',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_float_meta',
    ]);
    register_post_meta('artasia_place', 'artasia_lng', [
        'type'         => 'number',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_float_meta',
    ]);
    register_post_meta('artasia_place', 'artasia_city', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_place', 'artasia_postal_code', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_place', 'artasia_shared_with', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_place', 'artasia_accessibility_notes', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);

    // --- Project meta ---
    register_post_meta('artasia_project', 'artasia_project_year', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => intval(date('Y')),
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_project', 'artasia_project_description', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);

    // --- Activity meta ---
    register_post_meta('artasia_activity', 'artasia_project_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_activity', 'artasia_activity_week', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_activity', 'artasia_activity_description', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);
    register_post_meta('artasia_activity', 'artasia_activity_colour', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_hex_color',
    ]);

    // --- Placement meta ---
    register_post_meta('artasia_placement', 'artasia_project_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_publish_site', [
        'type'         => 'boolean',
        'single'       => true,
        'default'      => false,
        'show_in_rest' => false,
        'sanitize_callback' => 'artasia_sanitize_boolean_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_place_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_partner_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_team_member_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_secondary_team_member_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_program_context', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_placement', 'artasia_placement_description', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'wp_kses_post',
    ]);
    register_post_meta('artasia_placement', 'artasia_is_earlyon', [
        'type'         => 'boolean',
        'single'       => true,
        'default'      => false,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_boolean_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_section', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_placement', 'artasia_delivery_weekday', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_placement_weekday',
    ]);
    register_post_meta('artasia_placement', 'artasia_delivery_start_time', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_placement_time',
    ]);
    register_post_meta('artasia_placement', 'artasia_delivery_end_time', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_placement_time',
    ]);
    register_post_meta('artasia_placement', 'artasia_participant_count', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_placement', 'artasia_participant_age', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);

    // --- Artasia Partner meta ---
    register_post_meta('artasia_partner', 'artasia_partner_type', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_partner', 'artasia_partner_acronym', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_partner', 'artasia_website', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'esc_url_raw',
    ]);
    register_post_meta('artasia_partner', 'artasia_brand_color_one', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_hex_color_meta',
    ]);
    register_post_meta('artasia_partner', 'artasia_brand_color_two', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_hex_color_meta',
    ]);
    register_post_meta('artasia_partner', 'artasia_logo_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_partner', 'artasia_white_logo_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_partner', 'artasia_notes', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);

    // --- Artasia People meta ---
    register_post_meta('artasia_people', 'artasia_role', [
        'type'         => 'string',
        'single'       => true,
        'default'      => 'Artist Educator',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_people', 'artasia_email', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_email',
    ]);
    register_post_meta('artasia_people', 'artasia_pronouns', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_people', 'artasia_instagram', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_instagram_handle',
    ]);
    register_post_meta('artasia_people', 'artasia_portfolio_url', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'esc_url_raw',
    ]);
    register_post_meta('artasia_people', 'artasia_publish_profile', [
        'type'         => 'boolean',
        'single'       => true,
        'default'      => false,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_boolean_meta',
    ]);
    register_post_meta('artasia_people', 'artasia_photo_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_people', 'artasia_bio', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'wp_kses_post',
    ]);
    register_post_meta('artasia_people', 'artasia_notes', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);

    // --- Artasia Role meta ---
    register_post_meta('artasia_role', 'artasia_project_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_role', 'artasia_person_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_role', 'artasia_role_order', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);

    // --- Pedagogical Documentation meta ---
    register_post_meta('artasia_document', 'artasia_documentation_people_ids', [
        'type'         => 'array',
        'single'       => true,
        'default'      => [],
        'show_in_rest' => [
            'schema' => [
                'type'  => 'array',
                'items' => ['type' => 'integer'],
            ],
        ],
        'sanitize_callback' => 'artasia_sanitize_integer_array_meta',
    ]);
    register_post_meta('artasia_document', 'artasia_documentation_placement_ids', [
        'type'         => 'array',
        'single'       => true,
        'default'      => [],
        'show_in_rest' => [
            'schema' => [
                'type'  => 'array',
                'items' => ['type' => 'integer'],
            ],
        ],
        'sanitize_callback' => 'artasia_sanitize_integer_array_meta',
    ]);
    register_post_meta('artasia_document', 'artasia_documentation_pull_quote', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);
    register_post_meta('artasia_document', 'artasia_documentation_gallery_ids', [
        'type'         => 'array',
        'single'       => true,
        'default'      => [],
        'show_in_rest' => [
            'schema' => [
                'type'  => 'array',
                'items' => ['type' => 'integer'],
            ],
        ],
        'sanitize_callback' => 'artasia_sanitize_integer_array_meta',
    ]);
}

function artasia_sanitize_integer_meta($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): int
{
    return intval($value);
}

function artasia_sanitize_float_meta($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): float
{
    return floatval($value);
}

function artasia_sanitize_boolean_meta($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): bool
{
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}

function artasia_sanitize_integer_array_meta($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): array
{
    if (!is_array($value)) {
        return [];
    }

    return array_values(array_unique(array_filter(array_map('intval', $value))));
}

function artasia_sanitize_instagram_handle($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): string
{
    $handle = ltrim(trim(sanitize_text_field((string) $value)), '@');

    return preg_replace('/[^A-Za-z0-9._]/', '', $handle) ?: '';
}

add_action('init', 'artasia_register_meta_fields');
