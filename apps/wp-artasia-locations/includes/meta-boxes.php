<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_context_post_type_link(string $post_type, string $label): string
{
    return sprintf(
        '<a href="%s">%s</a>',
        esc_url(add_query_arg('post_type', $post_type, admin_url('edit.php'))),
        esc_html($label)
    );
}

function artasia_render_context_paragraph(string $paragraph): void
{
    echo wp_kses($paragraph, [
        'a' => [
            'href' => [],
        ],
        'code' => [],
    ]);
}

function artasia_post_type_contexts(): array
{
    return [
        'artasia_project' => [
            'title' => 'About Artasia Projects',
            'nav_label' => 'Projects',
            'paragraphs' => [
                'An Artasia Project captures the high-level annual flow for a year of Artasia activity.',
                sprintf(
                    'Use this record for the project year, project name, and a short description that frames related %s and %s.',
                    artasia_context_post_type_link('artasia_activity', 'activities'),
                    artasia_context_post_type_link('artasia_placement', 'placements')
                ),
                'Published projects are available in the project selectors of the Artasia Team, Artasia Sites, and Artasia Documentation Elementor widgets. The same features can be added with the <code>[artasia_team year="2026"]</code>, <code>[artasia_sites year="2026"]</code>, and <code>[artasia_documentation year="2026"]</code> shortcodes. Select the annual Documentation Landing Page in Project Details so Documentation links open in the correct annual viewer.',
            ],
        ],
        'artasia_activity' => [
            'title' => 'About Artasia Activities',
            'nav_label' => 'Activities',
            'paragraphs' => [
                sprintf(
                    'An Artasia Activity is a planned creative activity connected to an %s.',
                    artasia_context_post_type_link('artasia_project', 'Artasia Project')
                ),
                'Use this record for the activity name, project, program week, and activity description.',
            ],
        ],
        'artasia_partner' => [
            'title' => 'About Artasia Partners',
            'nav_label' => 'Partners',
            'paragraphs' => [
                'An Artasia Partner is an organization, program, community group, or school board that helps host or support Artasia.',
                'Use this record for partner identity, type, website, logo, and notes.',
            ],
        ],
        'artasia_place' => [
            'title' => 'About Artasia Places',
            'nav_label' => 'Places',
            'paragraphs' => [
                'An Artasia Place is a physical location such as a park, school, library, or community centre where Artasia activity can happen.',
                'Use this record for stable location details such as address, city, shared building context, coordinates, and access notes.',
            ],
        ],
        'artasia_people' => [
            'title' => 'About Artasia People',
            'nav_label' => 'People',
            'paragraphs' => [
                sprintf(
                    'Artasia People are team members who deliver programming to a %s during a %s.',
                    artasia_context_post_type_link('artasia_partner', 'partner'),
                    artasia_context_post_type_link('artasia_placement', 'placement')
                ),
                "Use this record for the person's name, default role, pronouns, public profile links, photo, current public bio, and internal notes.",
                'Published profiles can be displayed with the <code>[artasia_team year="2026"]</code> shortcode or the Artasia Team Elementor widget. A person appears only when the "Publish this person in Artasia team listings" checkbox is active and they are associated with the selected project through a placement or an Artasia Role.',
            ],
        ],
        'artasia_role' => [
            'title' => 'About Artasia Roles',
            'nav_label' => 'Roles',
            'paragraphs' => [
                sprintf(
                    'An Artasia Role connects one %s to one annual %s.',
                    artasia_context_post_type_link('artasia_people', 'person'),
                    artasia_context_post_type_link('artasia_project', 'project')
                ),
                'Use the title for the responsibility held in that year, such as Program Coordinator or Photographer.',
            ],
        ],
        'artasia_placement' => [
            'title' => 'About Artasia Placements',
            'nav_label' => 'Placements',
            'paragraphs' => [
                sprintf(
                    'Each Placement assigns an %s to a given %s at a given %s.',
                    artasia_context_post_type_link('artasia_people', 'person'),
                    artasia_context_post_type_link('artasia_partner', 'partner'),
                    artasia_context_post_type_link('artasia_place', 'place')
                ),
                sprintf(
                    'Use this record to name and describe the placement and connect the %s, %s, %s, program context, section, and participant details.',
                    artasia_context_post_type_link('artasia_project', 'project'),
                    artasia_context_post_type_link('artasia_place', 'place'),
                    artasia_context_post_type_link('artasia_partner', 'Artasia Partner')
                ),
                'Placements can be displayed by partner with the <code>[artasia_sites year="2026"]</code> shortcode or the Artasia Sites Elementor widget when their "Publish this placement in Artasia site listings" checkbox is active.',
            ],
        ],
        'artasia_document' => [
            'title' => 'About Pedagogical Documentation',
            'nav_label' => 'Documentation',
            'paragraphs' => [
                sprintf(
                    'Pedagogical Documentation records observations and reflection connected to the %s and %s involved in the work.',
                    artasia_context_post_type_link('artasia_people', 'people'),
                    artasia_context_post_type_link('artasia_placement', 'placements')
                ),
                'Use the classic rich text editor for the documentation itself, then identify its context and optionally provide a short pull quote.',
                'Build the image sequence in the Documentation Gallery panel. Captions and alternative text come from the selected Media Library records, and the gallery is displayed automatically after the documentation.',
                'Published records are indexed with the <code>[artasia_documentation year="2026"]</code> shortcode or the Artasia Documentation Elementor widget. A record appears under the partner connected to its selected placement and project, and opens in that project’s annual Documentation viewer.',
            ],
        ],
    ];
}

function artasia_get_post_type_context(string $post_type): ?array
{
    $contexts = artasia_post_type_contexts();

    return $contexts[$post_type] ?? null;
}

function artasia_context_meta_box_html(array $paragraphs): void
{
?>
    <img class="artasia-placements-list-logo" src="<?php echo esc_url(ARTASIA_LOCATIONS_URL . 'assets/artasia.svg'); ?>" alt="Artasia" />
    <?php foreach ($paragraphs as $paragraph) : ?>
        <p><?php artasia_render_context_paragraph($paragraph); ?></p>
    <?php endforeach; ?>
<?php
}

function artasia_context_list_header_html(string $current_post_type, array $paragraphs): void
{
    $contexts = artasia_post_type_contexts();
?>
    <div class="artasia-placements-list-context">
        <div class="artasia-placements-list-header">
            <img class="artasia-placements-list-logo" src="<?php echo esc_url(ARTASIA_LOCATIONS_URL . 'assets/artasia.svg'); ?>" alt="Artasia" />
            <nav class="artasia-post-type-nav" aria-label="Artasia post types">
                <?php foreach ($contexts as $post_type => $context) : ?>
                    <?php $is_current = $post_type === $current_post_type; ?>
                    <a
                        class="artasia-post-type-nav-link<?php echo $is_current ? ' is-active' : ''; ?>"
                        href="<?php echo esc_url(add_query_arg('post_type', $post_type, admin_url('edit.php'))); ?>"
                        <?php echo $is_current ? 'aria-current="page"' : ''; ?>>
                        <?php echo esc_html($context['nav_label']); ?>
                    </a>
                <?php endforeach; ?>
            </nav>
        </div>
        <div class="artasia-placements-list-copy">
            <?php foreach ($paragraphs as $paragraph) : ?>
                <p><?php artasia_render_context_paragraph($paragraph); ?></p>
            <?php endforeach; ?>
        </div>
    </div>
<?php
}

function artasia_placement_weekday_options(): array
{
    return [
        'monday' => 'Monday',
        'tuesday' => 'Tuesday',
        'wednesday' => 'Wednesday',
        'thursday' => 'Thursday',
        'friday' => 'Friday',
    ];
}

function artasia_placement_time_options(): array
{
    $options = [];
    for ($minutes = 9 * 60; $minutes <= 20 * 60; $minutes += 30) {
        $value = sprintf('%02d:%02d', intdiv($minutes, 60), $minutes % 60);
        $options[$value] = date_i18n('g:ia', strtotime($value));
    }

    return $options;
}

function artasia_sanitize_placement_weekday($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): string
{
    $value = strtolower(sanitize_key((string) $value));
    $options = artasia_placement_weekday_options();

    return isset($options[$value]) ? $value : '';
}

function artasia_sanitize_placement_time($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): string
{
    $value = sanitize_text_field((string) $value);
    $options = artasia_placement_time_options();

    return isset($options[$value]) ? $value : '';
}

function artasia_sanitize_hex_color_meta($value, string $meta_key = '', string $object_type = '', string $object_subtype = ''): string
{
    $color = sanitize_hex_color((string) $value);

    return $color ?: '';
}

function artasia_format_placement_schedule(int $post_id): string
{
    $weekdays = artasia_placement_weekday_options();
    $times = artasia_placement_time_options();
    $weekday = get_post_meta($post_id, 'artasia_delivery_weekday', true);
    $start_time = get_post_meta($post_id, 'artasia_delivery_start_time', true);
    $end_time = get_post_meta($post_id, 'artasia_delivery_end_time', true);

    if (!$weekday && !$start_time && !$end_time) {
        return '';
    }

    $time_range = trim(sprintf(
        '%s%s%s',
        $times[$start_time] ?? '',
        ($start_time && $end_time) ? ' - ' : '',
        $times[$end_time] ?? ''
    ));

    return trim(sprintf('%s%s%s', $weekdays[$weekday] ?? '', ($weekday && $time_range) ? ', ' : '', $time_range));
}

// --- Placement Details meta box ---

function artasia_placement_meta_box_html(WP_Post $post): void
{
    $projects = get_posts([
        'post_type'   => 'artasia_project',
        'numberposts' => -1,
        'meta_key'    => 'artasia_project_year',
        'orderby'     => [
            'meta_value_num' => 'DESC',
            'title' => 'ASC',
        ],
    ]);
    $places = get_posts([
        'post_type'   => 'artasia_place',
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
    $people = get_posts([
        'post_type'   => 'artasia_people',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);

    $project_id     = get_post_meta($post->ID, 'artasia_project_id', true);
    $publish_site   = (bool) get_post_meta($post->ID, 'artasia_publish_site', true);
    $place_id       = get_post_meta($post->ID, 'artasia_place_id', true);
    $partner_id     = get_post_meta($post->ID, 'artasia_partner_id', true);
    $team_member_id = get_post_meta($post->ID, 'artasia_team_member_id', true);
    $secondary_team_member_id = get_post_meta($post->ID, 'artasia_secondary_team_member_id', true);
    $program_context = get_post_meta($post->ID, 'artasia_program_context', true);
    $description = get_post_meta($post->ID, 'artasia_placement_description', true);
    $is_earlyon     = (bool) get_post_meta($post->ID, 'artasia_is_earlyon', true);
    $section        = get_post_meta($post->ID, 'artasia_section', true);
    $google_drive_folder_id = get_post_meta($post->ID, 'artasia_google_drive_folder_id', true);
    $participant_count = get_post_meta($post->ID, 'artasia_participant_count', true);
    $participant_age = get_post_meta($post->ID, 'artasia_participant_age', true);
    $delivery_weekday = get_post_meta($post->ID, 'artasia_delivery_weekday', true);
    $delivery_start_time = get_post_meta($post->ID, 'artasia_delivery_start_time', true);
    $delivery_end_time = get_post_meta($post->ID, 'artasia_delivery_end_time', true);
    $weekday_options = artasia_placement_weekday_options();
    $time_options = artasia_placement_time_options();

    wp_nonce_field('artasia_placement_meta', 'artasia_placement_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_project_id">Project</label></th>
            <td>
                <select id="artasia_project_id" name="artasia_project_id">
                    <option value="0">&mdash; Select Artasia Project &mdash;</option>
                    <?php foreach ($projects as $project) : ?>
                        <?php
                        $project_year = get_post_meta($project->ID, 'artasia_project_year', true);
                        $project_label = trim($project_year . ' - ' . $project->post_title, ' -');
                        ?>
                        <option value="<?php echo esc_attr($project->ID); ?>" <?php selected($project_id, $project->ID); ?>>
                            <?php echo esc_html($project_label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the annual Artasia Project this placement belongs to.</p>
            </td>
        </tr>
        <tr>
            <th>Public Site Listing</th>
            <td>
                <label for="artasia_publish_site">
                    <input type="checkbox" id="artasia_publish_site" name="artasia_publish_site" value="1" <?php checked($publish_site); ?> />
                    Publish this placement in Artasia site listings
                </label>
                <p class="description">Controls visibility in the <code>[artasia_sites]</code> shortcode and Artasia Sites Elementor widget only. It does not affect the Atlas viewer.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_team_member_id">Lead Artasia Team Member</label></th>
            <td>
                <select id="artasia_team_member_id" name="artasia_team_member_id">
                    <option value="0">&mdash; Select Lead Artasia Team Member &mdash;</option>
                    <?php foreach ($people as $person) : ?>
                        <option value="<?php echo esc_attr($person->ID); ?>" <?php selected($team_member_id, $person->ID); ?>>
                            <?php echo esc_html($person->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the lead Artasia team member responsible for this placement.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_secondary_team_member_id">Secondary Artasia Team Member</label></th>
            <td>
                <select id="artasia_secondary_team_member_id" name="artasia_secondary_team_member_id">
                    <option value="0">&mdash; Select Secondary Artasia Team Member &mdash;</option>
                    <?php foreach ($people as $person) : ?>
                        <option value="<?php echo esc_attr($person->ID); ?>" <?php selected($secondary_team_member_id, $person->ID); ?>>
                            <?php echo esc_html($person->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Optional supporting Artasia team member for placements delivered by two people.</p>
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
            <th><label for="artasia_place_id">Place</label></th>
            <td>
                <select id="artasia_place_id" name="artasia_place_id">
                    <option value="0">— Select Place —</option>
                    <?php foreach ($places as $place) : ?>
                        <option value="<?php echo esc_attr($place->ID); ?>" <?php selected($place_id, $place->ID); ?>>
                            <?php
                            $place_label = $place->post_title;
                            $place_address = get_post_meta($place->ID, 'artasia_address', true);
                            $place_city = get_post_meta($place->ID, 'artasia_city', true);
                            $place_details = array_filter([$place_address, $place_city]);
                            if (!empty($place_details)) {
                                $place_label .= ' - ' . implode(', ', $place_details);
                            }
                            echo esc_html($place_label);
                            ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">A Place is a location such as a Park, School, or Community Centre.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_program_context">Program / Context</label></th>
            <td><input type="text" id="artasia_program_context" name="artasia_program_context" value="<?php echo esc_attr($program_context); ?>" placeholder="Optional (e.g. Beyond the Bell)" class="widefat" />
                <p class="description">Artasia Partners welcome us in the context of specific existing programming activites (e.g. Summer Camps).</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_is_earlyon">EarlyON</label></th>
            <td>
                <img class="artasia-earlyon-logo" src="<?php echo esc_url(ARTASIA_LOCATIONS_URL . 'assets/early-on.svg'); ?>" alt="EarlyON" />
                <label>
                    <input type="checkbox" id="artasia_is_earlyon" name="artasia_is_earlyon" value="1" <?php checked($is_earlyon); ?> />
                    Mark as an EarlyON placement
                </label>
                <p class="description">EarlyON is an Ontario Government initiative often embedded inside partner locations and infrastructure.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_section">Section</label></th>
            <td>
                <input type="text" id="artasia_section" name="artasia_section" value="<?php echo esc_attr($section); ?>" placeholder="Optional (e.g. Room 3)" />
                <p class="description">Sometimes the same program is delivered multiple times at the same location, e.g. in different rooms or at different times</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_delivery_weekday">Delivery Day</label></th>
            <td>
                <select id="artasia_delivery_weekday" name="artasia_delivery_weekday">
                    <option value="">&mdash; Select Day &mdash;</option>
                    <?php foreach ($weekday_options as $value => $label) : ?>
                        <option value="<?php echo esc_attr($value); ?>" <?php selected($delivery_weekday, $value); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the weekday this placement is delivered.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_delivery_start_time">Start Time</label></th>
            <td>
                <select id="artasia_delivery_start_time" name="artasia_delivery_start_time">
                    <option value="">&mdash; Select Start Time &mdash;</option>
                    <?php foreach ($time_options as $value => $label) : ?>
                        <option value="<?php echo esc_attr($value); ?>" <?php selected($delivery_start_time, $value); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Times are available in 30-minute increments from 9:00am to 8:00pm.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_delivery_end_time">End Time</label></th>
            <td>
                <select id="artasia_delivery_end_time" name="artasia_delivery_end_time">
                    <option value="">&mdash; Select End Time &mdash;</option>
                    <?php foreach ($time_options as $value => $label) : ?>
                        <option value="<?php echo esc_attr($value); ?>" <?php selected($delivery_end_time, $value); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the planned weekly end time for this placement.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_participant_count">Participants</label></th>
            <td>
                <input type="number" id="artasia_participant_count" name="artasia_participant_count" value="<?php echo esc_attr($participant_count); ?>" />
                <p class="description">How many children are attending this placement?</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_participant_age">Age Range</label></th>
            <td>
                <input type="text" id="artasia_participant_age" name="artasia_participant_age" value="<?php echo esc_attr($participant_age); ?>" placeholder="e.g. 6-10" />
                <p class="description">Provide the age range of the attending children. Use number or words (e.g. 'School age')</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_google_drive_folder_id">Google Drive Documentation Folder</label></th>
            <td>
                <input type="text" id="artasia_google_drive_folder_id" name="artasia_google_drive_folder_id" value="<?php echo esc_attr($google_drive_folder_id); ?>" class="widefat" placeholder="Folder ID or Google Drive folder URL" />
                <p class="description"><a href="https://atlas.artsforall.co/admin" target="_blank" rel="noopener noreferrer">Atlas Admin</a> will open this folder first when importing files for this placement. The folder is assumed to store images, videos, and other assets documenting the placement. Paste either the folder ID or its full Google Drive URL.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_placement_description_editor">Description</label></th>
            <td>
                <?php
                wp_editor($description, 'artasia_placement_description_editor', [
                    'textarea_name' => 'artasia_placement_description',
                    'textarea_rows' => 10,
                    'media_buttons' => false,
                    'teeny'         => false,
                ]);
                ?>
                <p class="description">A rich-text description of this placement and its program context.</p>
            </td>
        </tr>
    </table>
<?php
}

function artasia_register_placement_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_placement');

    add_meta_box(
        'artasia_placement_details',
        'Placement Details',
        'artasia_placement_meta_box_html',
        'artasia_placement',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_placement_context',
        $context['title'],
        'artasia_placement_context_meta_box_html',
        'artasia_placement',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_placement_meta_box');

function artasia_placement_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_placement');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_placement_meta(int $post_id): void
{
    if (!isset($_POST['artasia_placement_meta_nonce']) || !wp_verify_nonce($_POST['artasia_placement_meta_nonce'], 'artasia_placement_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_project_id', intval($_POST['artasia_project_id'] ?? 0));
    update_post_meta($post_id, 'artasia_publish_site', isset($_POST['artasia_publish_site']));
    update_post_meta($post_id, 'artasia_program_context', sanitize_text_field($_POST['artasia_program_context'] ?? ''));
    update_post_meta($post_id, 'artasia_placement_description', wp_kses_post(wp_unslash($_POST['artasia_placement_description'] ?? '')));
    update_post_meta($post_id, 'artasia_is_earlyon', isset($_POST['artasia_is_earlyon']));
    update_post_meta($post_id, 'artasia_place_id', intval($_POST['artasia_place_id'] ?? 0));
    update_post_meta($post_id, 'artasia_partner_id', intval($_POST['artasia_partner_id'] ?? 0));
    update_post_meta($post_id, 'artasia_team_member_id', intval($_POST['artasia_team_member_id'] ?? 0));
    update_post_meta($post_id, 'artasia_secondary_team_member_id', intval($_POST['artasia_secondary_team_member_id'] ?? 0));
    update_post_meta($post_id, 'artasia_section', sanitize_text_field($_POST['artasia_section'] ?? ''));
    update_post_meta($post_id, 'artasia_google_drive_folder_id', artasia_sanitize_google_drive_folder_id($_POST['artasia_google_drive_folder_id'] ?? ''));
    update_post_meta($post_id, 'artasia_delivery_weekday', artasia_sanitize_placement_weekday($_POST['artasia_delivery_weekday'] ?? ''));
    update_post_meta($post_id, 'artasia_delivery_start_time', artasia_sanitize_placement_time($_POST['artasia_delivery_start_time'] ?? ''));
    update_post_meta($post_id, 'artasia_delivery_end_time', artasia_sanitize_placement_time($_POST['artasia_delivery_end_time'] ?? ''));
    update_post_meta($post_id, 'artasia_participant_count', intval($_POST['artasia_participant_count'] ?? 0));
    update_post_meta($post_id, 'artasia_participant_age', sanitize_text_field($_POST['artasia_participant_age'] ?? ''));

}
add_action('save_post_artasia_placement', 'artasia_save_placement_meta');

// --- Project Details meta box ---

function artasia_project_meta_box_html(WP_Post $post): void
{
    $project_year = get_post_meta($post->ID, 'artasia_project_year', true);
    if (!$project_year) {
        $project_year = date('Y');
    }
    $description = get_post_meta($post->ID, 'artasia_project_description', true);
    $documentation_page_id = intval(get_post_meta($post->ID, 'artasia_documentation_page_id', true));

    wp_nonce_field('artasia_project_meta', 'artasia_project_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_project_year">Year</label></th>
            <td><input type="number" id="artasia_project_year" name="artasia_project_year" value="<?php echo esc_attr($project_year); ?>" /></td>
        </tr>
        <tr>
            <th><label for="artasia_project_description">Description</label></th>
            <td><textarea id="artasia_project_description" name="artasia_project_description" rows="5" class="widefat"><?php echo esc_textarea($description); ?></textarea></td>
        </tr>
        <tr>
            <th><label for="artasia_documentation_page_id">Documentation Landing Page</label></th>
            <td>
                <?php
                wp_dropdown_pages([
                    'name'              => 'artasia_documentation_page_id',
                    'id'                => 'artasia_documentation_page_id',
                    'selected'          => $documentation_page_id,
                    'show_option_none'  => '— Select Documentation Landing Page —',
                    'option_none_value' => '0',
                    'class'             => 'widefat',
                ]);
                ?>
                <p class="description">Select the annual WordPress page containing the Artasia Documentation widget. Documentation links use this page for their public viewer URL.</p>
            </td>
        </tr>
    </table>
<?php
}

function artasia_register_project_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_project');

    add_meta_box(
        'artasia_project_details',
        'Project Details',
        'artasia_project_meta_box_html',
        'artasia_project',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_project_context',
        $context['title'],
        'artasia_project_context_meta_box_html',
        'artasia_project',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_project_meta_box');

function artasia_project_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_project');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_project_meta(int $post_id): void
{
    if (!isset($_POST['artasia_project_meta_nonce']) || !wp_verify_nonce($_POST['artasia_project_meta_nonce'], 'artasia_project_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_project_year', intval($_POST['artasia_project_year'] ?? 0));
    update_post_meta($post_id, 'artasia_project_description', sanitize_textarea_field($_POST['artasia_project_description'] ?? ''));
    $documentation_page_id = intval($_POST['artasia_documentation_page_id'] ?? 0);
    update_post_meta(
        $post_id,
        'artasia_documentation_page_id',
        get_post_type($documentation_page_id) === 'page' ? $documentation_page_id : 0
    );
}
add_action('save_post_artasia_project', 'artasia_save_project_meta');

// --- Activity Details meta box ---

function artasia_activity_meta_box_html(WP_Post $post): void
{
    $projects = get_posts([
        'post_type'   => 'artasia_project',
        'numberposts' => -1,
        'meta_key'    => 'artasia_project_year',
        'orderby'     => [
            'meta_value_num' => 'DESC',
            'title' => 'ASC',
        ],
    ]);

    $project_id = get_post_meta($post->ID, 'artasia_project_id', true);
    $week = get_post_meta($post->ID, 'artasia_activity_week', true);
    $description = get_post_meta($post->ID, 'artasia_activity_description', true);
    $colour = sanitize_hex_color(get_post_meta($post->ID, 'artasia_activity_colour', true)) ?: '#ffffff';

    wp_nonce_field('artasia_activity_meta', 'artasia_activity_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_project_id">Project</label></th>
            <td>
                <select id="artasia_project_id" name="artasia_project_id">
                    <option value="0">&mdash; Select Artasia Project &mdash;</option>
                    <?php foreach ($projects as $project) : ?>
                        <?php
                        $project_year = get_post_meta($project->ID, 'artasia_project_year', true);
                        $project_label = trim($project_year . ' - ' . $project->post_title, ' -');
                        ?>
                        <option value="<?php echo esc_attr($project->ID); ?>" <?php selected($project_id, $project->ID); ?>>
                            <?php echo esc_html($project_label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the Artasia Project this activity belongs to.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_activity_week">Program Week</label></th>
            <td>
                <input type="number" min="1" step="1" id="artasia_activity_week" name="artasia_activity_week" value="<?php echo esc_attr($week); ?>" />
                <p class="description">Optional week number when this activity is typically delivered.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_activity_description">Description</label></th>
            <td>
                <textarea id="artasia_activity_description" name="artasia_activity_description" rows="6" class="widefat"><?php echo esc_textarea($description); ?></textarea>
                <p class="description">Describe the activity, materials, intent, or delivery notes.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_activity_colour">Colour</label></th>
            <td>
                <input type="color" id="artasia_activity_colour" name="artasia_activity_colour" value="<?php echo esc_attr($colour); ?>" />
                <code><?php echo esc_html($colour); ?></code>
                <p class="description">Choose the hex colour used to identify this activity in the Atlas Viewer.</p>
            </td>
        </tr>
    </table>
<?php
}

function artasia_register_activity_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_activity');

    add_meta_box(
        'artasia_activity_details',
        'Activity Details',
        'artasia_activity_meta_box_html',
        'artasia_activity',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_activity_context',
        $context['title'],
        'artasia_activity_context_meta_box_html',
        'artasia_activity',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_activity_meta_box');

function artasia_activity_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_activity');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_activity_meta(int $post_id): void
{
    if (!isset($_POST['artasia_activity_meta_nonce']) || !wp_verify_nonce($_POST['artasia_activity_meta_nonce'], 'artasia_activity_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, 'artasia_project_id', intval($_POST['artasia_project_id'] ?? 0));
    update_post_meta($post_id, 'artasia_activity_week', intval($_POST['artasia_activity_week'] ?? 0));
    update_post_meta($post_id, 'artasia_activity_description', sanitize_textarea_field($_POST['artasia_activity_description'] ?? ''));
    update_post_meta($post_id, 'artasia_activity_colour', sanitize_hex_color($_POST['artasia_activity_colour'] ?? '') ?: '');
}
add_action('save_post_artasia_activity', 'artasia_save_activity_meta');

function artasia_post_type_admin_description(): void
{
    $screen = get_current_screen();

    if (!$screen || strpos((string) $screen->id, 'edit-') !== 0) {
        return;
    }

    $context = artasia_get_post_type_context($screen->post_type);
    if (!$context) {
        return;
    }

    artasia_context_list_header_html($screen->post_type, $context['paragraphs']);
}
add_action('all_admin_notices', 'artasia_post_type_admin_description');

// --- Place Details meta box ---

function artasia_place_meta_box_html(WP_Post $post): void
{
    $address  = get_post_meta($post->ID, 'artasia_address', true);
    $lat      = get_post_meta($post->ID, 'artasia_lat', true);
    $lng      = get_post_meta($post->ID, 'artasia_lng', true);
    $city     = get_post_meta($post->ID, 'artasia_city', true);
    $postal   = get_post_meta($post->ID, 'artasia_postal_code', true);
    $shared_with = get_post_meta($post->ID, 'artasia_shared_with', true);
    $access   = get_post_meta($post->ID, 'artasia_accessibility_notes', true);

    wp_nonce_field('artasia_place_meta', 'artasia_place_meta_nonce');
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
            <th><label for="artasia_shared_with">Shared With</label></th>
            <td>
                <input type="text" id="artasia_shared_with" name="artasia_shared_with" value="<?php echo esc_attr($shared_with); ?>" class="widefat" />
                <p class="description">Who else shares this building or venue? For example, a daycare may share a building with a school.</p>
            </td>
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

function artasia_register_place_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_place');

    add_meta_box(
        'artasia_place_details',
        'Place Details',
        'artasia_place_meta_box_html',
        'artasia_place',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_place_context',
        $context['title'],
        'artasia_place_context_meta_box_html',
        'artasia_place',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_place_meta_box');

function artasia_place_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_place');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_place_meta(int $post_id): void
{
    if (!isset($_POST['artasia_place_meta_nonce']) || !wp_verify_nonce($_POST['artasia_place_meta_nonce'], 'artasia_place_meta')) {
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
    update_post_meta($post_id, 'artasia_shared_with', sanitize_text_field($_POST['artasia_shared_with'] ?? ''));
    update_post_meta($post_id, 'artasia_accessibility_notes', sanitize_textarea_field($_POST['artasia_accessibility_notes'] ?? ''));
}
add_action('save_post_artasia_place', 'artasia_save_place_meta');

// --- Artasia Partner Details meta box ---

function artasia_partner_meta_box_html(WP_Post $post): void
{
    $type      = get_post_meta($post->ID, 'artasia_partner_type', true);
    $acronym   = get_post_meta($post->ID, 'artasia_partner_acronym', true);
    $website   = get_post_meta($post->ID, 'artasia_website', true);
    $logo_id   = intval(get_post_meta($post->ID, 'artasia_logo_id', true));
    $logo_url  = $logo_id ? wp_get_attachment_url($logo_id) : '';
    $white_logo_id  = intval(get_post_meta($post->ID, 'artasia_white_logo_id', true));
    $white_logo_url = $white_logo_id ? wp_get_attachment_url($white_logo_id) : '';
    $notes     = get_post_meta($post->ID, 'artasia_notes', true);
    $brand_color_one = get_post_meta($post->ID, 'artasia_brand_color_one', true);
    $brand_color_two = get_post_meta($post->ID, 'artasia_brand_color_two', true);

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
            <th><label for="artasia_partner_acronym">Acronym</label></th>
            <td><input type="text" id="artasia_partner_acronym" name="artasia_partner_acronym" value="<?php echo esc_attr($acronym); ?>" class="widefat" /></td>
        </tr>
        <tr>
            <th><label for="artasia_website">Website</label></th>
            <td><input type="url" id="artasia_website" name="artasia_website" value="<?php echo esc_attr($website); ?>" class="widefat" /></td>
        </tr>
        <tr>
            <th><label for="artasia_brand_color_one">Brand Color One</label></th>
            <td>
                <input type="text" id="artasia_brand_color_one" name="artasia_brand_color_one" value="<?php echo esc_attr($brand_color_one); ?>" placeholder="#ff6600" pattern="#[0-9a-fA-F]{6}" class="regular-text" />
                <p class="description">Optional hex color used for this partner's flower heads, e.g. <code>#ff6600</code>.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_brand_color_two">Brand Color Two</label></th>
            <td>
                <input type="text" id="artasia_brand_color_two" name="artasia_brand_color_two" value="<?php echo esc_attr($brand_color_two); ?>" placeholder="#8b160f" pattern="#[0-9a-fA-F]{6}" class="regular-text" />
                <p class="description">Optional secondary hex color used for this partner's flower center, e.g. <code>#8b160f</code>.</p>
            </td>
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
                <p class="description">SVG files work best with Inline CSS (Presentation Attributes) and explicit dimensions (Non Responsive). Set your Illustrator export settings accordingly.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_partner_white_logo_id">White Logo</label></th>
            <td>
                <input type="hidden" id="artasia_partner_white_logo_id" name="artasia_white_logo_id" value="<?php echo esc_attr($white_logo_id); ?>" />
                <div id="artasia_partner_white_logo_preview" class="artasia-logo-preview artasia-logo-preview--dark">
                    <?php if ($white_logo_url) : ?>
                        <img src="<?php echo esc_url($white_logo_url); ?>" alt="" />
                    <?php endif; ?>
                </div>
                <br />
                <button type="button" class="button" id="artasia_partner_white_logo_select">Select White Logo</button>
                <button type="button" class="button" id="artasia_partner_white_logo_remove" <?php disabled(!$white_logo_id); ?>>Remove White Logo</button>
                <p class="description">PNG or SVG. The dark preview background is for visibility and is not part of the uploaded logo.</p>
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
    $context = artasia_get_post_type_context('artasia_partner');

    add_meta_box(
        'artasia_partner_details',
        'Artasia Partner Details',
        'artasia_partner_meta_box_html',
        'artasia_partner',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_partner_context',
        $context['title'],
        'artasia_partner_context_meta_box_html',
        'artasia_partner',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_partner_meta_box');

function artasia_partner_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_partner');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

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
    update_post_meta($post_id, 'artasia_partner_acronym', sanitize_text_field($_POST['artasia_partner_acronym'] ?? ''));
    update_post_meta($post_id, 'artasia_website', esc_url_raw($_POST['artasia_website'] ?? ''));
    update_post_meta($post_id, 'artasia_brand_color_one', artasia_sanitize_hex_color_meta($_POST['artasia_brand_color_one'] ?? ''));
    update_post_meta($post_id, 'artasia_brand_color_two', artasia_sanitize_hex_color_meta($_POST['artasia_brand_color_two'] ?? ''));
    update_post_meta($post_id, 'artasia_logo_id', artasia_validate_partner_logo_id(intval($_POST['artasia_logo_id'] ?? 0)));
    update_post_meta($post_id, 'artasia_white_logo_id', artasia_validate_partner_logo_id(intval($_POST['artasia_white_logo_id'] ?? 0)));
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

// --- Artasia People Details meta box ---

function artasia_people_meta_box_html(WP_Post $post): void
{
    $role = get_post_meta($post->ID, 'artasia_role', true);
    if (!$role) {
        $role = 'Artist Educator';
    }
    $email = get_post_meta($post->ID, 'artasia_email', true);
    $pronouns = get_post_meta($post->ID, 'artasia_pronouns', true);
    $instagram = get_post_meta($post->ID, 'artasia_instagram', true);
    $portfolio_url = get_post_meta($post->ID, 'artasia_portfolio_url', true);
    $publish_profile = (bool) get_post_meta($post->ID, 'artasia_publish_profile', true);
    $photo_id = intval(get_post_meta($post->ID, 'artasia_photo_id', true));
    $photo_url = $photo_id ? wp_get_attachment_url($photo_id) : '';
    $bio = get_post_meta($post->ID, 'artasia_bio', true);
    $notes = get_post_meta($post->ID, 'artasia_notes', true);

    wp_nonce_field('artasia_people_meta', 'artasia_people_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_role">Default / Placement Role</label></th>
            <td>
                <input type="text" id="artasia_role" name="artasia_role" value="<?php echo esc_attr($role); ?>" class="widefat" />
                <p class="description">Used when this person belongs to a project through a placement. Add annual non-placement responsibilities under Artasia Roles.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_email">Email Address</label></th>
            <td><input type="email" id="artasia_email" name="artasia_email" value="<?php echo esc_attr($email); ?>" class="widefat" /></td>
        </tr>
        <tr>
            <th><label for="artasia_pronouns">Pronouns</label></th>
            <td><input type="text" id="artasia_pronouns" name="artasia_pronouns" value="<?php echo esc_attr($pronouns); ?>" class="widefat" placeholder="they/them" /></td>
        </tr>
        <tr>
            <th><label for="artasia_instagram">Instagram Handle</label></th>
            <td><input type="text" id="artasia_instagram" name="artasia_instagram" value="<?php echo esc_attr($instagram); ?>" class="widefat" placeholder="username" /></td>
        </tr>
        <tr>
            <th><label for="artasia_portfolio_url">Portfolio URL</label></th>
            <td><input type="url" id="artasia_portfolio_url" name="artasia_portfolio_url" value="<?php echo esc_attr($portfolio_url); ?>" class="widefat" placeholder="https://example.com" /></td>
        </tr>
        <tr>
            <th>Public Profile</th>
            <td>
                <label for="artasia_publish_profile">
                    <input type="checkbox" id="artasia_publish_profile" name="artasia_publish_profile" value="1" <?php checked($publish_profile); ?> />
                    Publish this person in Artasia team listings
                </label>
                <p class="description">When disabled, this person will not appear in the <code>[artasia_team]</code> shortcode, even when associated with the selected project.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_people_photo_id">Photo</label></th>
            <td>
                <input type="hidden" id="artasia_people_photo_id" name="artasia_photo_id" value="<?php echo esc_attr($photo_id); ?>" />
                <div id="artasia_people_photo_preview" class="artasia-image-preview">
                    <?php if ($photo_url) : ?>
                        <img src="<?php echo esc_url($photo_url); ?>" alt="" />
                    <?php endif; ?>
                </div>
                <button type="button" class="button" id="artasia_people_photo_select">Select Photo</button>
                <button type="button" class="button" id="artasia_people_photo_remove" <?php disabled(!$photo_id); ?>>Remove Photo</button>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_people_bio_editor">Bio</label></th>
            <td>
                <?php
                wp_editor($bio, 'artasia_people_bio_editor', [
                    'textarea_name' => 'artasia_bio',
                    'textarea_rows' => 10,
                    'media_buttons' => true,
                    'teeny'         => false,
                ]);
                ?>
                <p class="description">A public biography for this person. Rich text formatting and media are supported.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_people_notes">Notes</label></th>
            <td><textarea id="artasia_people_notes" name="artasia_notes" rows="4" class="widefat"><?php echo esc_textarea($notes); ?></textarea></td>
        </tr>
    </table>
<?php
}

function artasia_register_people_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_people');

    add_meta_box(
        'artasia_people_details',
        'Artasia People Details',
        'artasia_people_meta_box_html',
        'artasia_people',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_people_context',
        $context['title'],
        'artasia_people_context_meta_box_html',
        'artasia_people',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_people_meta_box');

function artasia_people_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_people');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_people_meta(int $post_id): void
{
    if (!isset($_POST['artasia_people_meta_nonce']) || !wp_verify_nonce($_POST['artasia_people_meta_nonce'], 'artasia_people_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    $role = sanitize_text_field($_POST['artasia_role'] ?? '');
    if (!$role) {
        $role = 'Artist Educator';
    }

    update_post_meta($post_id, 'artasia_role', $role);
    update_post_meta($post_id, 'artasia_email', sanitize_email($_POST['artasia_email'] ?? ''));
    update_post_meta($post_id, 'artasia_pronouns', sanitize_text_field($_POST['artasia_pronouns'] ?? ''));
    update_post_meta($post_id, 'artasia_instagram', artasia_sanitize_instagram_handle($_POST['artasia_instagram'] ?? ''));
    update_post_meta($post_id, 'artasia_portfolio_url', esc_url_raw($_POST['artasia_portfolio_url'] ?? ''));
    update_post_meta($post_id, 'artasia_publish_profile', isset($_POST['artasia_publish_profile']));
    update_post_meta($post_id, 'artasia_photo_id', artasia_validate_image_attachment_id(intval($_POST['artasia_photo_id'] ?? 0)));
    update_post_meta($post_id, 'artasia_bio', wp_kses_post(wp_unslash($_POST['artasia_bio'] ?? '')));
    update_post_meta($post_id, 'artasia_notes', sanitize_textarea_field($_POST['artasia_notes'] ?? ''));
}
add_action('save_post_artasia_people', 'artasia_save_people_meta');

// --- Artasia Role Details meta box ---

function artasia_role_meta_box_html(WP_Post $post): void
{
    $projects = get_posts([
        'post_type'   => 'artasia_project',
        'numberposts' => -1,
        'post_status' => ['publish', 'draft'],
        'meta_key'    => 'artasia_project_year',
        'orderby'     => 'meta_value_num',
        'order'       => 'DESC',
    ]);
    $people = get_posts([
        'post_type'   => 'artasia_people',
        'numberposts' => -1,
        'post_status' => ['publish', 'draft'],
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);
    $project_id = intval(get_post_meta($post->ID, 'artasia_project_id', true));
    $person_id = intval(get_post_meta($post->ID, 'artasia_person_id', true));
    $role_order = intval(get_post_meta($post->ID, 'artasia_role_order', true));

    wp_nonce_field('artasia_role_meta', 'artasia_role_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_project_id">Project</label></th>
            <td>
                <select id="artasia_project_id" name="artasia_project_id" class="widefat" required>
                    <option value="">Select a project</option>
                    <?php foreach ($projects as $project) : ?>
                        <?php $year = get_post_meta($project->ID, 'artasia_project_year', true); ?>
                        <option value="<?php echo esc_attr($project->ID); ?>" <?php selected($project_id, $project->ID); ?>>
                            <?php echo esc_html(trim($year . ' - ' . $project->post_title, ' -')); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_person_id">Person</label></th>
            <td>
                <select id="artasia_person_id" name="artasia_person_id" class="widefat" required>
                    <option value="">Select a person</option>
                    <?php foreach ($people as $person) : ?>
                        <option value="<?php echo esc_attr($person->ID); ?>" <?php selected($person_id, $person->ID); ?>>
                            <?php echo esc_html($person->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_role_order">Display Order</label></th>
            <td><input type="number" id="artasia_role_order" name="artasia_role_order" value="<?php echo esc_attr($role_order); ?>" min="0" /></td>
        </tr>
    </table>
<?php
}

function artasia_register_role_meta_box(): void
{
    add_meta_box('artasia_role_details', 'Role Assignment', 'artasia_role_meta_box_html', 'artasia_role', 'normal', 'default');
    add_meta_box('artasia_role_context', 'About Artasia Roles', 'artasia_role_context_meta_box_html', 'artasia_role', 'side', 'high');
}
add_action('add_meta_boxes', 'artasia_register_role_meta_box');

function artasia_role_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_role');
    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_save_role_meta(int $post_id): void
{
    if (!isset($_POST['artasia_role_meta_nonce']) || !wp_verify_nonce($_POST['artasia_role_meta_nonce'], 'artasia_role_meta')) {
        return;
    }
    if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || !current_user_can('edit_post', $post_id)) {
        return;
    }

    $project_id = intval($_POST['artasia_project_id'] ?? 0);
    $person_id = intval($_POST['artasia_person_id'] ?? 0);

    update_post_meta($post_id, 'artasia_project_id', get_post_type($project_id) === 'artasia_project' ? $project_id : 0);
    update_post_meta($post_id, 'artasia_person_id', get_post_type($person_id) === 'artasia_people' ? $person_id : 0);
    update_post_meta($post_id, 'artasia_role_order', max(0, intval($_POST['artasia_role_order'] ?? 0)));
}
add_action('save_post_artasia_role', 'artasia_save_role_meta');

function artasia_validate_image_attachment_id(int $attachment_id): int
{
    if (!$attachment_id) {
        return 0;
    }

    $mime_type = get_post_mime_type($attachment_id);

    return strpos((string) $mime_type, 'image/') === 0 ? $attachment_id : 0;
}

// --- Pedagogical Documentation meta box ---

function artasia_documentation_meta_box_html(WP_Post $post): void
{
    $people = get_posts([
        'post_type'   => 'artasia_people',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);
    $placements = get_posts([
        'post_type'   => 'artasia_placement',
        'numberposts' => -1,
        'orderby'     => 'title',
        'order'       => 'ASC',
    ]);
    $people_ids = artasia_sanitize_integer_array_meta(
        get_post_meta($post->ID, 'artasia_documentation_people_ids', true)
    );
    $placement_ids = artasia_sanitize_integer_array_meta(
        get_post_meta($post->ID, 'artasia_documentation_placement_ids', true)
    );
    $people_id = $people_ids[0] ?? 0;
    $placement_id = $placement_ids[0] ?? 0;
    $pull_quote = get_post_meta($post->ID, 'artasia_documentation_pull_quote', true);

    wp_nonce_field('artasia_documentation_meta', 'artasia_documentation_meta_nonce');
?>
    <table class="form-table">
        <tr>
            <th><label for="artasia_documentation_people_ids">Person</label></th>
            <td>
                <select id="artasia_documentation_people_ids" name="artasia_documentation_people_ids[]" class="widefat">
                    <option value="">&mdash; Select Person &mdash;</option>
                    <?php foreach ($people as $person) : ?>
                        <option value="<?php echo esc_attr($person->ID); ?>" <?php selected($people_id, $person->ID); ?>>
                            <?php echo esc_html($person->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the person who authored, facilitated, or contributed to this documentation.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_documentation_placement_ids">Placement</label></th>
            <td>
                <select id="artasia_documentation_placement_ids" name="artasia_documentation_placement_ids[]" class="widefat">
                    <option value="">&mdash; Select Placement &mdash;</option>
                    <?php foreach ($placements as $placement) : ?>
                        <?php
                        $placement_section = trim((string) get_post_meta($placement->ID, 'artasia_section', true));
                        $placement_label = $placement->post_title
                            . ($placement_section !== '' ? ' — ' . $placement_section : '');
                        ?>
                        <option value="<?php echo esc_attr($placement->ID); ?>" <?php selected($placement_id, $placement->ID); ?>>
                            <?php echo esc_html($placement_label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description">Select the placement that defines where and in what program context the documentation occurred.</p>
            </td>
        </tr>
        <tr>
            <th><label for="artasia_documentation_pull_quote">Pull Quote</label></th>
            <td>
                <textarea id="artasia_documentation_pull_quote" name="artasia_documentation_pull_quote" rows="4" class="widefat" placeholder="Optional short excerpt"><?php echo esc_textarea($pull_quote); ?></textarea>
                <p class="description">A concise excerpt that can be highlighted when this documentation is displayed.</p>
            </td>
        </tr>
    </table>
<?php
}

function artasia_register_documentation_meta_box(): void
{
    $context = artasia_get_post_type_context('artasia_document');

    add_meta_box(
        'artasia_documentation_details',
        'Documentation Context',
        'artasia_documentation_meta_box_html',
        'artasia_document',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_documentation_gallery',
        'Documentation Gallery',
        'artasia_documentation_gallery_meta_box_html',
        'artasia_document',
        'normal',
        'default'
    );

    add_meta_box(
        'artasia_documentation_about',
        $context['title'],
        'artasia_documentation_context_meta_box_html',
        'artasia_document',
        'side',
        'high'
    );
}
add_action('add_meta_boxes', 'artasia_register_documentation_meta_box');

function artasia_documentation_gallery_meta_box_html(WP_Post $post): void
{
    $gallery_ids = artasia_validate_image_attachment_ids(
        get_post_meta($post->ID, 'artasia_documentation_gallery_ids', true)
    );
    $saved_captions = artasia_sanitize_text_array_meta(
        get_post_meta($post->ID, 'artasia_documentation_gallery_captions', true)
    );
?>
    <p>Select images from the Media Library, then drag them into the order in which they should appear.</p>
    <p class="description">Edit each caption below its thumbnail. The caption appears in the gallery and lightbox. Alternative text continues to come from the Media Library.</p>
    <p>
        <button type="button" class="button button-primary" id="artasia_documentation_gallery_select">Select gallery images</button>
        <button type="button" class="button" id="artasia_documentation_gallery_clear" <?php disabled(empty($gallery_ids)); ?>>Remove all</button>
    </p>
    <ul id="artasia_documentation_gallery_items" class="artasia-documentation-gallery-items">
        <?php foreach ($gallery_ids as $index => $attachment_id) : ?>
            <?php
            $caption = array_key_exists($index, $saved_captions)
                ? $saved_captions[$index]
                : (wp_get_attachment_caption($attachment_id) ?: get_the_title($attachment_id));
            ?>
            <li class="artasia-documentation-gallery-item" data-attachment-id="<?php echo esc_attr($attachment_id); ?>">
                <span class="artasia-documentation-gallery-handle dashicons dashicons-move" aria-label="Drag to reorder" title="Drag to reorder"></span>
                <?php echo wp_get_attachment_image($attachment_id, 'medium', false, ['class' => 'artasia-documentation-gallery-thumbnail']); ?>
                <label class="screen-reader-text" for="artasia-documentation-caption-<?php echo esc_attr($attachment_id); ?>">Image caption</label>
                <textarea
                    id="artasia-documentation-caption-<?php echo esc_attr($attachment_id); ?>"
                    class="artasia-documentation-gallery-caption"
                    name="artasia_documentation_gallery_captions[]"
                    rows="4"
                    placeholder="Add a caption"
                ><?php echo esc_textarea($caption); ?></textarea>
                <input type="hidden" name="artasia_documentation_gallery_ids[]" value="<?php echo esc_attr($attachment_id); ?>">
                <button type="button" class="button-link-delete artasia-documentation-gallery-remove">Remove</button>
            </li>
        <?php endforeach; ?>
    </ul>
<?php
}

function artasia_documentation_context_meta_box_html(): void
{
    $context = artasia_get_post_type_context('artasia_document');
    if (!$context) {
        return;
    }

    artasia_context_meta_box_html($context['paragraphs']);
}

function artasia_validate_related_post_ids($values, string $post_type): array
{
    $ids = artasia_sanitize_integer_array_meta($values);

    return array_values(array_filter($ids, static function (int $post_id) use ($post_type): bool {
        return get_post_type($post_id) === $post_type;
    }));
}

function artasia_validate_image_attachment_ids($values): array
{
    $ids = artasia_sanitize_integer_array_meta($values);

    return array_values(array_filter($ids, static function (int $attachment_id): bool {
        return get_post_type($attachment_id) === 'attachment'
            && strpos((string) get_post_mime_type($attachment_id), 'image/') === 0;
    }));
}

function artasia_save_documentation_meta(int $post_id): void
{
    if (!isset($_POST['artasia_documentation_meta_nonce']) || !wp_verify_nonce($_POST['artasia_documentation_meta_nonce'], 'artasia_documentation_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta(
        $post_id,
        'artasia_documentation_people_ids',
        artasia_validate_related_post_ids($_POST['artasia_documentation_people_ids'] ?? [], 'artasia_people')
    );
    update_post_meta(
        $post_id,
        'artasia_documentation_placement_ids',
        artasia_validate_related_post_ids($_POST['artasia_documentation_placement_ids'] ?? [], 'artasia_placement')
    );
    update_post_meta(
        $post_id,
        'artasia_documentation_pull_quote',
        sanitize_textarea_field($_POST['artasia_documentation_pull_quote'] ?? '')
    );
    update_post_meta(
        $post_id,
        'artasia_documentation_gallery_ids',
        artasia_validate_image_attachment_ids($_POST['artasia_documentation_gallery_ids'] ?? [])
    );
    update_post_meta(
        $post_id,
        'artasia_documentation_gallery_captions',
        artasia_sanitize_text_array_meta($_POST['artasia_documentation_gallery_captions'] ?? [])
    );
}
add_action('save_post_artasia_document', 'artasia_save_documentation_meta');

function artasia_remove_unnecessary_meta_boxes(): void
{
    $post_types = ['artasia_project', 'artasia_activity', 'artasia_partner', 'artasia_place', 'artasia_people', 'artasia_role', 'artasia_placement', 'artasia_document'];
    $meta_box_contexts = ['side', 'normal', 'advanced'];

    foreach ($post_types as $post_type) {
        foreach ($meta_box_contexts as $meta_box_context) {
            remove_meta_box('passster', $post_type, $meta_box_context);
        }
    }
}
add_action('add_meta_boxes', 'artasia_remove_unnecessary_meta_boxes', 99);
