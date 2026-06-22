<?php

if (!defined('ABSPATH')) {
    exit;
}

// --- Site Details meta box ---

function artasia_site_meta_box_html(WP_Post $post): void
{
    $venues = get_posts([
        'post_type'   => 'artasia_venue',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);
    $contexts = get_posts([
        'post_type'   => 'artasia_context',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);

    $venue_id       = get_post_meta($post->ID, 'artasia_venue_id', true);
    $context_id     = get_post_meta($post->ID, 'artasia_context_id', true);
    $program_year   = get_post_meta($post->ID, 'artasia_program_year', true);
    $section        = get_post_meta($post->ID, 'artasia_section', true);
    $participant_count = get_post_meta($post->ID, 'artasia_participant_count', true);
    $participant_age = get_post_meta($post->ID, 'artasia_participant_age', true);
    $start_date     = get_post_meta($post->ID, 'artasia_start_date', true);
    $end_date       = get_post_meta($post->ID, 'artasia_end_date', true);

    wp_nonce_field('artasia_site_meta', 'artasia_site_meta_nonce');
    ?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_program_year">Program Year</label></th>
            <td><input type="number" id="artasia_program_year" name="artasia_program_year" value="<?php echo esc_attr($program_year); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_venue_id">Venue</label></th>
            <td>
                <select id="artasia_venue_id" name="artasia_venue_id">
                    <option value="0">— Select Venue —</option>
                    <?php foreach ($venues as $venue) : ?>
                        <option value="<?php echo esc_attr($venue->ID); ?>" <?php selected($venue_id, $venue->ID); ?>>
                            <?php echo esc_html($venue->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_context_id">Context</label></th>
            <td>
                <select id="artasia_context_id" name="artasia_context_id">
                    <option value="0">— Select Context —</option>
                    <?php foreach ($contexts as $context) : ?>
                        <option value="<?php echo esc_attr($context->ID); ?>" <?php selected($context_id, $context->ID); ?>>
                            <?php echo esc_html($context->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_section">Section</label></th>
            <td><input type="text" id="artasia_section" name="artasia_section" value="<?php echo esc_attr($section); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_participant_count">Participants</label></th>
            <td><input type="number" id="artasia_participant_count" name="artasia_participant_count" value="<?php echo esc_attr($participant_count); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_participant_age">Ages</label></th>
            <td><input type="text" id="artasia_participant_age" name="artasia_participant_age" value="<?php echo esc_attr($participant_age); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_start_date">Start Date</label></th>
            <td><input type="text" id="artasia_start_date" name="artasia_start_date" value="<?php echo esc_attr($start_date); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_end_date">End Date</label></th>
            <td><input type="text" id="artasia_end_date" name="artasia_end_date" value="<?php echo esc_attr($end_date); ?>" /></td>
        </tr>
    </table>
    <?php
}

function artasia_register_site_meta_box(): void
{
    add_meta_box(
        'artasia_site_details',
        'Site Details',
        'artasia_site_meta_box_html',
        'artasia_site',
        'normal',
        'default'
    );
}
add_action('add_meta_boxes', 'artasia_register_site_meta_box');

function artasia_save_site_meta(int $post_id): void
{
    if (!isset($_POST['artasia_site_meta_nonce']) || !wp_verify_nonce($_POST['artasia_site_meta_nonce'], 'artasia_site_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_program_year', intval($_POST['artasia_program_year'] ?? 0));
    update_post_meta($post_id, 'artasia_venue_id', intval($_POST['artasia_venue_id'] ?? 0));
    update_post_meta($post_id, 'artasia_context_id', intval($_POST['artasia_context_id'] ?? 0));
    update_post_meta($post_id, 'artasia_section', sanitize_text_field($_POST['artasia_section'] ?? ''));
    update_post_meta($post_id, 'artasia_participant_count', intval($_POST['artasia_participant_count'] ?? 0));
    update_post_meta($post_id, 'artasia_participant_age', sanitize_text_field($_POST['artasia_participant_age'] ?? ''));
    update_post_meta($post_id, 'artasia_start_date', sanitize_text_field($_POST['artasia_start_date'] ?? ''));
    update_post_meta($post_id, 'artasia_end_date', sanitize_text_field($_POST['artasia_end_date'] ?? ''));
}
add_action('save_post_artasia_site', 'artasia_save_site_meta');

// --- Venue Details meta box ---

function artasia_venue_meta_box_html(WP_Post $post): void
{
    $address  = get_post_meta($post->ID, 'artasia_address', true);
    $lat      = get_post_meta($post->ID, 'artasia_lat', true);
    $lng      = get_post_meta($post->ID, 'artasia_lng', true);
    $city     = get_post_meta($post->ID, 'artasia_city', true);
    $postal   = get_post_meta($post->ID, 'artasia_postal_code', true);
    $access   = get_post_meta($post->ID, 'artasia_accessibility_notes', true);

    wp_nonce_field('artasia_venue_meta', 'artasia_venue_meta_nonce');
    ?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_address">Address</label></th>
            <td><input type="text" id="artasia_address" name="artasia_address" value="<?php echo esc_attr($address); ?>" class="widefat" /></td>
        </tr>
        <tr>
            <th><label for="artasia_lat">Latitude</label></th>
            <td><input type="number" step="any" id="artasia_lat" name="artasia_lat" value="<?php echo esc_attr($lat); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_lng">Longitude</label></th>
            <td><input type="number" step="any" id="artasia_lng" name="artasia_lng" value="<?php echo esc_attr($lng); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_city">City</label></th>
            <td><input type="text" id="artasia_city" name="artasia_city" value="<?php echo esc_attr($city); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_postal_code">Postal Code</label></th>
            <td><input type="text" id="artasia_postal_code" name="artasia_postal_code" value="<?php echo esc_attr($postal); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_accessibility_notes">Accessibility Notes</label></th>
            <td><textarea id="artasia_accessibility_notes" name="artasia_accessibility_notes" rows="4" class="widefat"><?php echo esc_textarea($access); ?></textarea></td>
        </tr>
    </table>
    <?php
}

function artasia_register_venue_meta_box(): void
{
    add_meta_box(
        'artasia_venue_details',
        ' venue Details',
        'artasia_venue_meta_box_html',
        'artasia_venue',
        'normal',
        'default'
    );
}
add_action('add_meta_boxes', 'artasia_register_venue_meta_box');

function artasia_save_venue_meta(int $post_id): void
{
    if (!isset($_POST['artasia_venue_meta_nonce']) || !wp_verify_nonce($_POST['artasia_venue_meta_nonce'], 'artasia_venue_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_address', sanitize_text_field($_POST['artasia_address'] ?? ''));
    update_post_meta($post_id, 'artasia_lat', floatval($_POST['artasia_lat'] ?? 0));
    update_post_meta($post_id, 'artasia_lng', floatval($_POST['artasia_lng'] ?? 0));
    update_post_meta($post_id, 'artasia_city', sanitize_text_field($_POST['artasia_city'] ?? ''));
    update_post_meta($post_id, 'artasia_postal_code', sanitize_text_field($_POST['artasia_postal_code'] ?? ''));
    update_post_meta($post_id, 'artasia_accessibility_notes', sanitize_textarea_field($_POST['artasia_accessibility_notes'] ?? ''));
}
add_action('save_post_artasia_venue', 'artasia_save_venue_meta');

// --- Context Details meta box ---

function artasia_context_meta_box_html(WP_Post $post): void
{
    $type    = get_post_meta($post->ID, 'artasia_context_type', true);
    $website = get_post_meta($post->ID, 'artasia_website', true);
    $notes   = get_post_meta($post->ID, 'artasia_contact_notes', true);

    $type_options = ['Partner Organization', 'Program', 'Community Group', 'School Board', 'Other'];

    wp_nonce_field('artasia_context_meta', 'artasia_context_meta_nonce');
    ?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_context_type">Type</label></th>
            <td>
                <select id="artasia_context_type" name="artasia_context_type">
                    <option value="">— Select Type —</option>
                    <?php foreach ($type_options as $option) : ?>
                        <option value="<?php echo esc_attr($option); ?>" <?php selected($type, $option); ?>>
                            <?php echo esc_html($option); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_website">Website</label></th>
            <td><input type="url" id="artasia_website" name="artasia_website" value="<?php echo esc_attr($website); ?>" class="widefat" /></td>
        </tr>
        <tr>
            <th><label for="artasia_contact_notes">Contact Notes</label></th>
            <td><textarea id="artasia_contact_notes" name="artasia_contact_notes" rows="4" class="widefat"><?php echo esc_textarea($notes); ?></textarea></td>
        </tr>
    </table>
    <?php
}

function artasia_register_context_meta_box(): void
{
    add_meta_box(
        'artasia_context_details',
        'Context Details',
        'artasia_context_meta_box_html',
        'artasia_context',
        'normal',
        'default'
    );
}
add_action('add_meta_boxes', 'artasia_register_context_meta_box');

function artasia_save_context_meta(int $post_id): void
{
    if (!isset($_POST['artasia_context_meta_nonce']) || !wp_verify_nonce($_POST['artasia_context_meta_nonce'], 'artasia_context_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_context_type', sanitize_text_field($_POST['artasia_context_type'] ?? ''));
    update_post_meta($post_id, 'artasia_website', esc_url_raw($_POST['artasia_website'] ?? ''));
    update_post_meta($post_id, 'artasia_contact_notes', sanitize_textarea_field($_POST['artasia_contact_notes'] ?? ''));
}
add_action('save_post_artasia_context', 'artasia_save_context_meta');