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
        'sanitize_callback' => 'floatval',
    ]);
    register_post_meta('artasia_venue', 'artasia_lng', [
        'type'         => 'number',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'floatval',
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
        'sanitize_callback' => 'intval',
    ]);
    register_post_meta('artasia_site', 'artasia_context_id', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'intval',
    ]);
    register_post_meta('artasia_site', 'artasia_program_year', [
        'type'         => 'integer',
        'single'       => true,
        'default'      => 0,
        'show_in_rest' => true,
        'sanitize_callback' => 'intval',
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
        'sanitize_callback' => 'intval',
    ]);
    register_post_meta('artasia_site', 'artasia_participant_age', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_site', 'artasia_start_date', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_site', 'artasia_end_date', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);

    // --- Context meta ---
    register_post_meta('artasia_context', 'artasia_context_type', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_text_field',
    ]);
    register_post_meta('artasia_context', 'artasia_website', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'esc_url_raw',
    ]);
    register_post_meta('artasia_context', 'artasia_contact_notes', [
        'type'         => 'string',
        'single'       => true,
        'default'      => '',
        'show_in_rest' => true,
        'sanitize_callback' => 'sanitize_textarea_field',
    ]);
}

add_action('init', 'artasia_register_meta_fields');