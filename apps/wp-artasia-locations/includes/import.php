<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_import_page(): void
{
    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia CSV Import',
        'CSV Import',
        'edit_posts',
        'artasia-placements-import',
        'artasia_render_import_page'
    );
}
add_action('admin_menu', 'artasia_register_import_page');

function artasia_render_import_page(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to import Artasia placements.', 'wp-artasia-locations'));
    }

    $imported = isset($_GET['imported']) ? intval($_GET['imported']) : null;
    $skipped = isset($_GET['skipped']) ? intval($_GET['skipped']) : null;
    $errors = isset($_GET['errors']) ? intval($_GET['errors']) : null;

    ?>
    <div class="wrap">
        <h1>Artasia CSV Import</h1>

        <?php if ($imported !== null) : ?>
            <div class="notice notice-success is-dismissible">
                <p><?php echo esc_html(sprintf('Import complete: %d placement rows imported, %d skipped, %d with errors.', $imported, $skipped, $errors)); ?></p>
            </div>
        <?php endif; ?>

        <p>Upload a CSV file to create Artasia Projects, Places, Partners, People, and Placements in one pass.</p>
        <p>The importer finds existing Projects, Places, Partners, and People by title. If none exists, it creates them. Placements are matched by placement name, Project, Place, Partner, and Section.</p>

        <h2>CSV Template</h2>
        <p>
            <a class="button" href="<?php echo esc_url(admin_url('admin-post.php?action=artasia_placements_import_template')); ?>">Download example CSV</a>
        </p>

        <h2>Headers</h2>
        <p>Required headers: <code>placement_name</code>, <code>project_name</code>, <code>place_name</code>, <code>partner_name</code>.</p>
        <p>Optional headers: <code>project_year</code>, <code>project_description</code>, <code>program_context</code>, <code>earlyon</code>, <code>section</code>, <code>participants</code>, <code>age_range</code>, <code>place_street_address</code>, <code>place_city</code>, <code>place_postal_code</code>, <code>place_latitude</code>, <code>place_longitude</code>, <code>place_notes</code>, <code>partner_type</code>, <code>partner_website</code>, <code>partner_notes</code>, <code>team_member_name</code>, <code>team_member_role</code>, <code>team_member_notes</code>.</p>
        <p>For <code>earlyon</code>, use values like <code>yes</code>, <code>no</code>, <code>true</code>, <code>false</code>, <code>1</code>, or <code>0</code>.</p>

        <h2>Upload CSV</h2>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
            <input type="hidden" name="action" value="artasia_placements_import_csv" />
            <?php wp_nonce_field('artasia_placements_import_csv', 'artasia_placements_import_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="artasia_placements_csv">CSV File</label></th>
                    <td><input type="file" id="artasia_placements_csv" name="artasia_placements_csv" accept=".csv,text/csv" required /></td>
                </tr>
            </table>
            <?php submit_button('Import CSV'); ?>
        </form>
    </div>
    <?php
}

function artasia_download_import_template(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to download this template.', 'wp-artasia-locations'));
    }

    $headers = artasia_import_csv_headers();
    $example = [
        'placement_name' => 'Artasia at Central Library',
        'project_name' => 'Artasia ' . date('Y'),
        'project_year' => date('Y'),
        'project_description' => 'Annual Artasia project flow',
        'place_name' => 'Central Library',
        'place_street_address' => '55 York Blvd',
        'place_city' => 'Hamilton',
        'place_postal_code' => 'L8R 3K1',
        'place_latitude' => '43.258',
        'place_longitude' => '-79.872',
        'place_notes' => 'Use main entrance',
        'partner_name' => 'Hamilton Public Library',
        'partner_type' => 'Partner Organization',
        'partner_website' => 'https://www.hpl.ca',
        'partner_notes' => 'Library partner',
        'team_member_name' => 'Taylor Morgan',
        'team_member_role' => 'Artist Educator',
        'team_member_notes' => 'Team member notes for this placement',
        'program_context' => 'Beyond the Bell',
        'earlyon' => 'no',
        'section' => 'Room 3',
        'participants' => '24',
        'age_range' => '6-10',
    ];

    nocache_headers();
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="artasia-placements-import-template.csv"');

    $output = fopen('php://output', 'w');
    fputcsv($output, $headers);
    fputcsv($output, array_map(static function (string $header) use ($example) {
        return $example[$header] ?? '';
    }, $headers));
    fclose($output);
    exit;
}
add_action('admin_post_artasia_placements_import_template', 'artasia_download_import_template');

function artasia_handle_import_csv(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to import Artasia placements.', 'wp-artasia-locations'));
    }

    if (!isset($_POST['artasia_placements_import_nonce']) || !wp_verify_nonce($_POST['artasia_placements_import_nonce'], 'artasia_placements_import_csv')) {
        wp_die(esc_html__('Invalid import request.', 'wp-artasia-locations'));
    }

    if (empty($_FILES['artasia_placements_csv']['tmp_name']) || !is_uploaded_file($_FILES['artasia_placements_csv']['tmp_name'])) {
        artasia_redirect_import_page(['imported' => 0, 'skipped' => 0, 'errors' => 1]);
    }

    $filename = isset($_FILES['artasia_placements_csv']['name']) ? sanitize_file_name($_FILES['artasia_placements_csv']['name']) : '';
    if (strtolower(pathinfo($filename, PATHINFO_EXTENSION)) !== 'csv') {
        artasia_redirect_import_page(['imported' => 0, 'skipped' => 0, 'errors' => 1]);
    }

    $result = artasia_import_placements_csv($_FILES['artasia_placements_csv']['tmp_name']);
    artasia_redirect_import_page($result);
}
add_action('admin_post_artasia_placements_import_csv', 'artasia_handle_import_csv');

function artasia_import_placements_csv(string $path): array
{
    $handle = fopen($path, 'r');
    if (!$handle) {
        return ['imported' => 0, 'skipped' => 0, 'errors' => 1];
    }

    $header_row = fgetcsv($handle);
    if (!$header_row) {
        fclose($handle);
        return ['imported' => 0, 'skipped' => 0, 'errors' => 1];
    }

    $headers = array_map('artasia_normalize_import_header', $header_row);
    $imported = 0;
    $skipped = 0;
    $errors = 0;

    while (($row = fgetcsv($handle)) !== false) {
        if (artasia_import_row_is_empty($row)) {
            continue;
        }

        $record = artasia_import_combine_row($headers, $row);
        $row_result = artasia_import_location_record($record);

        if ($row_result === 'imported') {
            $imported++;
        } elseif ($row_result === 'skipped') {
            $skipped++;
        } else {
            $errors++;
        }
    }

    fclose($handle);

    return [
        'imported' => $imported,
        'skipped' => $skipped,
        'errors' => $errors,
    ];
}

function artasia_import_location_record(array $record): string
{
    $placement_name = artasia_import_value($record, 'placement_name');
    $project_name = artasia_import_value($record, 'project_name');
    $place_name = artasia_import_value($record, 'place_name');
    $partner_name = artasia_import_value($record, 'partner_name');

    if (!$placement_name || !$project_name || !$place_name || !$partner_name) {
        return 'skipped';
    }

    $project_year = intval(artasia_import_value($record, 'project_year'));
    if (!$project_year) {
        $project_year = intval(date('Y'));
    }

    $project_id = artasia_import_find_or_create_project($project_name, $project_year);
    $place_id = artasia_import_find_or_create_post('artasia_place', $place_name);
    $partner_id = artasia_import_find_or_create_post('artasia_partner', $partner_name);
    $team_member_id = 0;
    $team_member_name = artasia_import_value($record, 'team_member_name');
    if ($team_member_name) {
        $team_member_id = artasia_import_find_or_create_post('artasia_people', $team_member_name);
    }

    if (!$project_id || !$place_id || !$partner_id || ($team_member_name && !$team_member_id)) {
        return 'error';
    }

    update_post_meta($project_id, 'artasia_project_year', $project_year);
    artasia_import_update_meta_if_present($project_id, 'artasia_project_description', $record, 'project_description', 'sanitize_textarea_field');

    artasia_import_update_meta_if_present($place_id, 'artasia_address', $record, 'place_street_address', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_city', $record, 'place_city', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_postal_code', $record, 'place_postal_code', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_lat', $record, 'place_latitude', 'floatval');
    artasia_import_update_meta_if_present($place_id, 'artasia_lng', $record, 'place_longitude', 'floatval');
    artasia_import_update_meta_if_present($place_id, 'artasia_accessibility_notes', $record, 'place_notes', 'sanitize_textarea_field');

    artasia_import_update_meta_if_present($partner_id, 'artasia_partner_type', $record, 'partner_type', 'sanitize_text_field');
    artasia_import_update_meta_if_present($partner_id, 'artasia_website', $record, 'partner_website', 'esc_url_raw');
    artasia_import_update_meta_if_present($partner_id, 'artasia_notes', $record, 'partner_notes', 'sanitize_textarea_field');

    if ($team_member_id) {
        update_post_meta($team_member_id, 'artasia_role', sanitize_text_field(artasia_import_value($record, 'team_member_role') ?: 'Artist Educator'));
        artasia_import_update_meta_if_present($team_member_id, 'artasia_notes', $record, 'team_member_notes', 'sanitize_textarea_field');
    }

    $section = artasia_import_value($record, 'section');

    $placement_id = artasia_import_find_placement($placement_name, $project_id, $place_id, $partner_id, $section);
    if (!$placement_id) {
        $placement_id = wp_insert_post([
            'post_title' => $placement_name,
            'post_type' => 'artasia_placement',
            'post_status' => 'publish',
        ], true);
    }

    if (is_wp_error($placement_id) || !$placement_id) {
        return 'error';
    }

    update_post_meta($placement_id, 'artasia_project_id', $project_id);
    update_post_meta($placement_id, 'artasia_place_id', $place_id);
    update_post_meta($placement_id, 'artasia_partner_id', $partner_id);
    if ($team_member_id) {
        update_post_meta($placement_id, 'artasia_team_member_id', $team_member_id);
    }
    update_post_meta($placement_id, 'artasia_program_context', sanitize_text_field(artasia_import_value($record, 'program_context')));
    update_post_meta($placement_id, 'artasia_is_earlyon', artasia_import_boolean(artasia_import_value($record, 'earlyon')));
    update_post_meta($placement_id, 'artasia_section', sanitize_text_field($section));
    update_post_meta($placement_id, 'artasia_participant_count', intval(artasia_import_value($record, 'participants')));
    update_post_meta($placement_id, 'artasia_participant_age', sanitize_text_field(artasia_import_value($record, 'age_range')));

    return 'imported';
}

function artasia_import_csv_headers(): array
{
    return [
        'placement_name',
        'project_name',
        'project_year',
        'project_description',
        'place_name',
        'place_street_address',
        'place_city',
        'place_postal_code',
        'place_latitude',
        'place_longitude',
        'place_notes',
        'partner_name',
        'partner_type',
        'partner_website',
        'partner_notes',
        'team_member_name',
        'team_member_role',
        'team_member_notes',
        'program_context',
        'earlyon',
        'section',
        'participants',
        'age_range',
    ];
}

function artasia_import_find_or_create_project(string $title, int $year): int
{
    $matches = get_posts([
        'post_type' => 'artasia_project',
        'title' => $title,
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => 1,
        'fields' => 'ids',
        'meta_query' => [
            [
                'key' => 'artasia_project_year',
                'value' => $year,
                'compare' => '=',
                'type' => 'NUMERIC',
            ],
        ],
    ]);

    if (!empty($matches)) {
        return intval($matches[0]);
    }

    $post_id = wp_insert_post([
        'post_title' => $title,
        'post_type' => 'artasia_project',
        'post_status' => 'publish',
    ], true);

    return is_wp_error($post_id) ? 0 : intval($post_id);
}

function artasia_import_find_or_create_post(string $post_type, string $title): int
{
    $existing = get_posts([
        'post_type' => $post_type,
        'title' => $title,
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => 1,
        'fields' => 'ids',
    ]);

    if (!empty($existing)) {
        return intval($existing[0]);
    }

    $post_id = wp_insert_post([
        'post_title' => $title,
        'post_type' => $post_type,
        'post_status' => 'publish',
    ], true);

    return is_wp_error($post_id) ? 0 : intval($post_id);
}

function artasia_import_find_placement(string $title, int $project_id, int $place_id, int $partner_id, string $section): int
{
    $matches = get_posts([
        'post_type' => 'artasia_placement',
        'title' => $title,
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => 1,
        'fields' => 'ids',
        'meta_query' => [
            'relation' => 'AND',
            [
                'key' => 'artasia_project_id',
                'value' => $project_id,
                'compare' => '=',
                'type' => 'NUMERIC',
            ],
            [
                'key' => 'artasia_place_id',
                'value' => $place_id,
                'compare' => '=',
                'type' => 'NUMERIC',
            ],
            [
                'key' => 'artasia_partner_id',
                'value' => $partner_id,
                'compare' => '=',
                'type' => 'NUMERIC',
            ],
            [
                'key' => 'artasia_section',
                'value' => $section,
                'compare' => '=',
            ],
        ],
    ]);

    return empty($matches) ? 0 : intval($matches[0]);
}

function artasia_import_update_meta_if_present(int $post_id, string $meta_key, array $record, string $header, callable $sanitize_callback): void
{
    $value = artasia_import_value($record, $header);
    if ($value === '') {
        return;
    }

    update_post_meta($post_id, $meta_key, call_user_func($sanitize_callback, $value));
}

function artasia_import_value(array $record, string $key): string
{
    return isset($record[$key]) ? trim((string) $record[$key]) : '';
}

function artasia_import_boolean(string $value): bool
{
    return in_array(strtolower(trim($value)), ['1', 'yes', 'y', 'true', 'earlyon'], true);
}

function artasia_import_combine_row(array $headers, array $row): array
{
    $record = [];
    foreach ($headers as $index => $header) {
        if (!$header) {
            continue;
        }
        $record[$header] = $row[$index] ?? '';
    }
    return $record;
}

function artasia_normalize_import_header(string $header): string
{
    $header = preg_replace('/^\xEF\xBB\xBF/', '', $header);
    return strtolower(trim($header));
}

function artasia_import_row_is_empty(array $row): bool
{
    foreach ($row as $value) {
        if (trim((string) $value) !== '') {
            return false;
        }
    }
    return true;
}

function artasia_redirect_import_page(array $result): void
{
    wp_safe_redirect(add_query_arg([
        'post_type' => 'artasia_placement',
        'page' => 'artasia-placements-import',
        'imported' => intval($result['imported'] ?? 0),
        'skipped' => intval($result['skipped'] ?? 0),
        'errors' => intval($result['errors'] ?? 0),
    ], admin_url('edit.php')));
    exit;
}
