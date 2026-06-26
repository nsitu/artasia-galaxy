<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_meta_fields(): void
{
    // --- Venue meta ---
    register_post_meta('artasia_venue', 'artasia_address', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_venue', 'artasia_lat', [
        'type'         => 'number',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_float_meta',
    ]);
    register_post_meta('artasia_venue', 'artasia_lng', [
        'type'         => 'number',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_float_meta',
    ]);
    register_post_meta('artasia_venue', 'artasia_city', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_venue', 'artasia_postal_code', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_venue', 'artasia_accessibility_notes', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);

    // --- Site meta ---
    register_post_meta('artasia_site', 'artasia_venue_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_partner_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_lead_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_program_year', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => intval(date('Y')),
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_program_context', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_site', 'artasia_is_earlyon', [
        'type'         => 'boolean',
        'single'       => true,
        'default'      => false,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_boolean_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_section', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_site', 'artasia_participant_count', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'artasia_sanitize_integer_meta',
    ]);
    register_post_meta('artasia_site', 'artasia_participant_age', [
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
    register_post_meta('artasia_partner', 'artasia_website', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'esc_url_raw',
    ]);
    register_post_meta('artasia_partner', 'artasia_logo_id', [
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

add_action('init', 'artasia_register_meta_fields');
