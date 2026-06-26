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
    $partners = get_posts([
        'post_type'   => 'artasia_partner',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);

    $venue_id       = get_post_meta($post->ID, 'artasia_venue_id', true);
    $partner_id     = get_post_meta($post->ID, 'artasia_partner_id', true);
    $program_year   = get_post_meta($post->ID, 'artasia_program_year', true);
    if (!$program_year) {
        $program_year = date('Y');
    }
    $program_context = get_post_meta($post->ID, 'artasia_program_context', true);
    $is_earlyon     = (bool) get_post_meta($post->ID, 'artasia_is_earlyon', true);
    $section        = get_post_meta($post->ID, 'artasia_section', true);
    $participant_count = get_post_meta($post->ID, 'artasia_participant_count', true);
    $participant_age = get_post_meta($post->ID, 'artasia_participant_age', true);

    wp_nonce_field('artasia_site_meta', 'artasia_site_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_program_year">Artasia Year</label></th>
            <td><input type="number" id="artasia_program_year" name="artasia_program_year" value="<?php echo esc_attr($program_year); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_venue_id">Venue</label></th>
            <td>
                <select id="artasia_venue_id" name="artasia_venue_id">
                    <option value="0">— Select Venue —</option>
                    <?php foreach ($venues as $venue) : ?>
                        <option value="<?php echo esc_attr($venue->ID); ?>" <?php selected($venue_id, $venue->ID); ?>>
                            <?php
                            $venue_label = $venue->post_title;
                            $venue_address = get_post_meta($venue->ID, 'artasia_address', true);
                            $venue_city = get_post_meta($venue->ID, 'artasia_city', true);
                            $venue_details = array_filter([$venue_address, $venue_city]);
                            if (!empty($venue_details)) {
                                $venue_label .= ' - ' . implode(', ', $venue_details);
                            }
                            echo esc_html($venue_label);
                            ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">A Venue is a location such as a Park, School, or Community Centre.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_partner_id">Artasia Partner</label></th>
            <td>
                <select id="artasia_partner_id" name="artasia_partner_id">
                    <option value="0">— Select Artasia Partner —</option>
                    <?php foreach ($partners as $partner) : ?>
                        <option value="<?php echo esc_attr($partner->ID); ?>" <?php selected($partner_id, $partner->ID); ?>>
                            <?php echo esc_html($partner->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Arts For All works with many community partners to deliver Artasia in Hamilton and surrounding Regions.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_program_context">Program / Context</label></th>
            <td><input type="text" id="artasia_program_context" name="artasia_program_context" value="<?php echo esc_attr($program_context); ?>" placeholder="e.g. Beyond the Bell" class="widefat" />
                <p class="description">Artasia Partners welcome us in the context of specific existing programming activites (e.g. Summer Camps).</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_is_earlyon">EarlyON</label></th>
            <td>
                <label>
                    <input type="checkbox" id="artasia_is_earlyon" name="artasia_is_earlyon" value="1" <?php checked($is_earlyon); ?> />
                    Mark as an EarlyON site
                </label>
                <p class="description">EarlyON is an Ontario Government initiative often embedded inside of partner locations and infrastructure.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_section">Section</label></th>
            <td>
                <input type="text" id="artasia_section" name="artasia_section" value="<?php echo esc_attr($section); ?>" placeholder="e.g. Room 3" />
                <p class="description">Sometimes the same program is delivered multiple times at the same location, e.g. in different rooms or at different times</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_participant_count">Participants</label></th>
            <td>
                <input type="number" id="artasia_participant_count" name="artasia_participant_count" value="<?php echo esc_attr($participant_count); ?>" />
                <p class="description">How many children are attending the program at this site?</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_participant_age">Age Range</label></th>
            <td>
                <input type="text" id="artasia_participant_age" name="artasia_participant_age" value="<?php echo esc_attr($participant_age); ?>" placeholder="e.g. 6-10" />
                <p class="description">Provide the age range of the attending children. Use number or words (e.g. 'School age')</p>
            </td>
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

    add_meta_box(
        'artasia_site_context',
        'About Artasia Sites',
        'artasia_site_context_meta_box_html',
        'artasia_site',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_site_meta_box');

function artasia_site_context_meta_box_html(): void
{
?>
    <p>An Artasia Site represents one year's activation of a particular venue by a particular Artasia Partner.</p>
    <p>Use this post to connect the venue, Artasia Partner, program context, section, and participant details for that activation.</p>
<?php
}

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
    update_post_meta($post_id, 'artasia_program_context', sanitize_text_field($_POST['artasia_program_context'] ?? ''));
    update_post_meta($post_id, 'artasia_is_earlyon', isset($_POST['artasia_is_earlyon']));
    update_post_meta($post_id, 'artasia_venue_id', intval($_POST['artasia_venue_id'] ?? 0));
    update_post_meta($post_id, 'artasia_partner_id', intval($_POST['artasia_partner_id'] ?? 0));
    update_post_meta($post_id, 'artasia_section', sanitize_text_field($_POST['artasia_section'] ?? ''));
    update_post_meta($post_id, 'artasia_participant_count', intval($_POST['artasia_participant_count'] ?? 0));
    update_post_meta($post_id, 'artasia_participant_age', sanitize_text_field($_POST['artasia_participant_age'] ?? ''));
}
add_action('save_post_artasia_site', 'artasia_save_site_meta');

function artasia_site_admin_description(): void
{
    $screen = get_current_screen();

    if (!$screen || $screen->id !== 'edit-artasia_site') {
        return;
    }

?>
    <div class="artasia-sites-list-context">
        <img class="artasia-sites-list-logo" src="<?php echo esc_url(ARTASIA_LOCATIONS_URL . 'assets/artasia.svg'); ?>" alt="Artasia" />
        <p>An Artasia Site represents one year's activation of a particular venue by a particular Artasia Partner.</p>
        <p>Use these records to connect venues, Artasia Partners, program context, section, and participant details for each activation.</p>
    </div>
<?php
}
add_action('all_admin_notices', 'artasia_site_admin_description');

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
            <th><label for="artasia_address">Street Address</label></th>
            <td><input type="text" id="artasia_address" name="artasia_address" value="<?php echo esc_attr($address); ?>" class="widefat" /></td>
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
            <th><label for="artasia_lat">Latitude</label></th>
            <td><input type="number" step="any" id="artasia_lat" name="artasia_lat" value="<?php echo esc_attr($lat); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_lng">Longitude</label></th>
            <td><input type="number" step="any" id="artasia_lng" name="artasia_lng" value="<?php echo esc_attr($lng); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_accessibility_notes">Notes</label></th>
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

// --- Artasia Partner Details meta box ---

function artasia_partner_meta_box_html(WP_Post $post): void
{
    $type    = get_post_meta($post->ID, 'artasia_partner_type', true);
    $website = get_post_meta($post->ID, 'artasia_website', true);
    $logo_id = intval(get_post_meta($post->ID, 'artasia_logo_id', true));
    $logo_url = $logo_id ? wp_get_attachment_url($logo_id) : '';
    $notes   = get_post_meta($post->ID, 'artasia_notes', true);

    $type_options = ['Partner Organization', 'Program', 'Community Group', 'School Board', 'Other'];

    wp_nonce_field('artasia_partner_meta', 'artasia_partner_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_partner_type">Type</label></th>
            <td>
                <select id="artasia_partner_type" name="artasia_partner_type">
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
            <th><label for="artasia_partner_logo_id">Logo</label></th>
            <td>
                <input type="hidden" id="artasia_partner_logo_id" name="artasia_logo_id" value="<?php echo esc_attr($logo_id); ?>" />
                <div id="artasia_partner_logo_preview" class="artasia-logo-preview">
                    <?php if ($logo_url) : ?>
                        <img src="<?php echo esc_url($logo_url); ?>" alt="" />
                    <?php endif; ?>
                </div>
                <button type="button" class="button" id="artasia_partner_logo_select">Select Logo</button>
                <button type="button" class="button" id="artasia_partner_logo_remove" <?php disabled(!$logo_id); ?>>Remove Logo</button>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_notes">Notes</label></th>
            <td><textarea id="artasia_notes" name="artasia_notes" rows="4" class="widefat"><?php echo esc_textarea($notes); ?></textarea></td>
        </tr>
    </table>
<?php
}

function artasia_register_partner_meta_box(): void
{
    add_meta_box(
        'artasia_partner_details',
        'Artasia Partner Details',
        'artasia_partner_meta_box_html',
        'artasia_partner',
        'normal',
        'default'
    );
}
add_action('add_meta_boxes', 'artasia_register_partner_meta_box');

function artasia_save_partner_meta(int $post_id): void
{
    if (!isset($_POST['artasia_partner_meta_nonce']) || !wp_verify_nonce($_POST['artasia_partner_meta_nonce'], 'artasia_partner_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_partner_type', sanitize_text_field($_POST['artasia_partner_type'] ?? ''));
    update_post_meta($post_id, 'artasia_website', esc_url_raw($_POST['artasia_website'] ?? ''));
    update_post_meta($post_id, 'artasia_logo_id', artasia_validate_partner_logo_id(intval($_POST['artasia_logo_id'] ?? 0)));
    update_post_meta($post_id, 'artasia_notes', sanitize_textarea_field($_POST['artasia_notes'] ?? ''));
}
add_action('save_post_artasia_partner', 'artasia_save_partner_meta');

function artasia_validate_partner_logo_id(int $attachment_id): int
{
    if (!$attachment_id) {
        return 0;
    }

    $mime_type = get_post_mime_type($attachment_id);
    $allowed_mime_types = ['image/png', 'image/svg+xml'];

    return in_array($mime_type, $allowed_mime_types, true) ? $attachment_id : 0;
}

function artasia_remove_unnecessary_meta_boxes(): void
{
    $post_types = ['artasia_venue', 'artasia_site', 'artasia_partner'];
    $meta_box_contexts = ['side', 'normal', 'advanced'];

    foreach ($post_types as $post_type) {
        foreach ($meta_box_contexts as $meta_box_context) {
            remove_meta_box('passster', $post_type, $meta_box_context);
        }
    }
}
add_action('add_meta_boxes', 'artasia_remove_unnecessary_meta_boxes', 99);
