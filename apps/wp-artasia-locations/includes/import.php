<?php

if (!defined('ABSPATH')) {
    exit;
}

const ARTASIA_TOOLS_PAGE_SLUG = 'artasia-tools';

function artasia_atlas_base_url(): string
{
    return rtrim((string) apply_filters('artasia_atlas_base_url', 'https://atlas.artsforall.co'), '/');
}

function artasia_register_tools_page(): void
{
    add_submenu_page(
        'edit.php?post_type=artasia_placement',
        'Artasia Tools',
        'Tools',
        'edit_posts',
        ARTASIA_TOOLS_PAGE_SLUG,
        'artasia_render_tools_page'
    );
}
add_action('admin_menu', 'artasia_register_tools_page');

function artasia_default_reconcile_url(): string
{
    return artasia_atlas_base_url() . '/api/v1/reconcile';
}

function artasia_get_reconcile_url(): string
{
    $value = get_option('artasia_reconcile_url', '');
    return $value ? $value : artasia_default_reconcile_url();
}

function artasia_get_reconcile_secret(): string
{
    return (string) get_option('artasia_reconcile_secret', '');
}

function artasia_render_tools_page(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to access Artasia tools.', 'wp-artasia-locations'));
    }

    $imported = isset($_GET['imported']) ? intval($_GET['imported']) : null;
    $skipped = isset($_GET['skipped']) ? intval($_GET['skipped']) : null;
    $errors = isset($_GET['errors']) ? intval($_GET['errors']) : null;

    $reconcile_status = isset($_GET['reconcile']) ? sanitize_key((string) $_GET['reconcile']) : '';
    $reconcile_applied = isset($_GET['applied']) ? intval($_GET['applied']) : null;
    $reconcile_mutations = isset($_GET['mutations']) ? intval($_GET['mutations']) : null;
    $reconcile_message = isset($_GET['message']) ? sanitize_text_field((string) $_GET['message']) : '';

    $settings_saved = isset($_GET['settings_saved']) ? true : false;
    $settings_error = isset($_GET['settings_error']) ? sanitize_text_field((string) $_GET['settings_error']) : '';

    $reconcile_url = artasia_get_reconcile_url();
    $reconcile_secret_set = (bool) artasia_get_reconcile_secret();
    ?>
    <div class="wrap">
        <h1>Artasia Tools</h1>

        <?php if ($imported !== null) : ?>
            <div class="notice notice-success is-dismissible">
                <p><?php echo esc_html(sprintf('Import complete: %d placement rows imported, %d skipped, %d with errors.', $imported, $skipped, $errors)); ?></p>
            </div>
        <?php endif; ?>

        <?php if ($settings_saved) : ?>
            <div class="notice notice-success is-dismissible"><p>Reconcile settings saved.</p></div>
        <?php endif; ?>
        <?php if ($settings_error) : ?>
            <div class="notice notice-error is-dismissible"><p><?php echo esc_html($settings_error); ?></p></div>
        <?php endif; ?>

        <?php if ($reconcile_status === 'success') : ?>
            <div class="notice notice-success is-dismissible">
                <p>
                    <?php
                    if ($reconcile_applied) {
                        echo esc_html(sprintf('Reconcile ran successfully. %d mutation(s) applied.', $reconcile_mutations));
                    } else {
                        echo esc_html('Reconcile ran. No drift detected — nothing to apply.');
                    }
                    ?>
                </p>
            </div>
        <?php elseif ($reconcile_status === 'error') : ?>
            <div class="notice notice-error is-dismissible">
                <p><?php echo esc_html(sprintf('Reconcile failed: %s', $reconcile_message ?: 'unknown error')); ?></p>
            </div>
        <?php endif; ?>

        <h2>Reconcile Immich</h2>
        <p>Trigger a manual reconcile between WordPress placement data and Immich tags. The Atlas server will sync human-readable tags on existing assets via the durable <code>placement:&lt;id&gt;</code> anchor tags, archive orphaned placements, and restore previously archived ones.</p>

        <h3>Settings</h3>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="artasia_save_reconcile_settings" />
            <?php wp_nonce_field('artasia_save_reconcile_settings', 'artasia_reconcile_settings_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="artasia_reconcile_url">Reconcile endpoint URL</label></th>
                    <td>
                        <input type="url" id="artasia_reconcile_url" name="artasia_reconcile_url" value="<?php echo esc_attr($reconcile_url); ?>" class="regular-text" />
                        <p class="description">Atlas <code>/api/v1/reconcile</code> endpoint. Production default: <code><?php echo esc_html(artasia_default_reconcile_url()); ?></code>.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="artasia_reconcile_secret">Reconcile secret</label></th>
                    <td>
                        <input type="password" id="artasia_reconcile_secret" name="artasia_reconcile_secret" value="" placeholder="<?php echo $reconcile_secret_set ? '(stored — leave blank to keep)' : ''; ?>" class="regular-text" autocomplete="new-password" />
                        <p class="description">Shared secret matching the Atlas server's <code>RECONCILE_SECRET</code> env var. Sent via the <code>x-reconcile-secret</code> header.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save settings'); ?>
        </form>

        <h3>Run reconcile</h3>
        <?php if (!$reconcile_secret_set) : ?>
            <div class="notice notice-warning inline"><p>The reconcile secret is not set. Save the settings above before running reconcile.</p></div>
        <?php else : ?>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="artasia_reconcile_run" />
                <?php wp_nonce_field('artasia_reconcile_run', 'artasia_reconcile_run_nonce'); ?>
                <p class="submit">
                    <button type="submit" class="button button-primary" id="artasia-reconcile-run">Run reconcile now</button>
                    <span class="description">Sends an authenticated POST to the Atlas reconcile endpoint. May take a few seconds depending on the number of placements and assets.</span>
                </p>
            </form>
        <?php endif; ?>

        <hr />

        <h2>CSV Import</h2>
        <p>Upload a CSV file to create Artasia Projects, Places, Partners, People, and Placements in one pass.</p>
        <p>The importer finds existing Projects, Places, Partners, and People by title. If none exists, it creates them. Placements are matched by placement name, Project, Place, Partner, and Section.</p>

        <h3>CSV Template</h3>
        <p>
            <a class="button" href="<?php echo esc_url(admin_url('admin-post.php?action=artasia_placements_import_template')); ?>">Download example CSV</a>
        </p>

        <h3>Headers</h3>
        <p>Required headers: <code>placement_name</code>, <code>project_name</code>, <code>place_name</code>, <code>partner_name</code>.</p>
        <p>Optional headers: <code>project_year</code>, <code>project_description</code>, <code>program_context</code>, <code>earlyon</code>, <code>section</code>, <code>delivery_weekday</code>, <code>delivery_start_time</code>, <code>delivery_end_time</code>, <code>participants</code>, <code>age_range</code>, <code>place_street_address</code>, <code>place_city</code>, <code>place_postal_code</code>, <code>place_shared_with</code>, <code>place_latitude</code>, <code>place_longitude</code>, <code>place_notes</code>, <code>partner_type</code>, <code>partner_website</code>, <code>partner_brand_color_one</code>, <code>partner_brand_color_two</code>, <code>partner_notes</code>, <code>team_member_name</code>, <code>team_member_role</code>, <code>team_member_email</code>, <code>team_member_notes</code>, <code>secondary_team_member_name</code>, <code>secondary_team_member_role</code>, <code>secondary_team_member_email</code>, <code>secondary_team_member_notes</code>.</p>
        <p>For <code>earlyon</code>, use values like <code>yes</code>, <code>no</code>, <code>true</code>, <code>false</code>, <code>1</code>, or <code>0</code>.</p>
        <p>For delivery times, use 24-hour values like <code>09:00</code>, <code>09:30</code>, or <code>20:00</code>.</p>

        <h3>Upload CSV</h3>
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

        <hr />

        <h2>Anecdote CSV Dry Run</h2>
        <p>Upload an anecdote CSV or tab-separated file to infer its WordPress relationships. This first-pass tool does not create or update any posts.</p>
        <p>The report preserves the original columns and adds the matched person, the most likely placement from that person's primary and secondary assignments, and an activity inferred by ordering submission dates within that placement and mapping them to the project's configured activity week numbers.</p>
        <p>Required data: timestamp, person, site, participant age, and anecdote text. Header matching is case-insensitive and accepts the current form-export names (<code>Artasia Team Member</code>, <code>Participant ages</code>, and <code>Anecdote</code>) as well as the shorter names (<code>Person</code>, <code>Age</code>, and <code>Story</code>).</p>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
            <input type="hidden" name="action" value="artasia_anecdotes_dry_run" />
            <?php wp_nonce_field('artasia_anecdotes_dry_run', 'artasia_anecdotes_dry_run_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="artasia_anecdotes_csv">Anecdote CSV File</label></th>
                    <td>
                        <input type="file" id="artasia_anecdotes_csv" name="artasia_anecdotes_csv" accept=".csv,.tsv,text/csv,text/tab-separated-values" required />
                        <p class="description">CSV and TSV exports are accepted. No anecdotes will be imported.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Download Inference Report'); ?>
        </form>
    </div>
    <?php
}

function artasia_handle_save_reconcile_settings(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to update reconcile settings.', 'wp-artasia-locations'));
    }

    if (!isset($_POST['artasia_reconcile_settings_nonce']) || !wp_verify_nonce($_POST['artasia_reconcile_settings_nonce'], 'artasia_save_reconcile_settings')) {
        wp_die(esc_html__('Invalid reconcile settings request.', 'wp-artasia-locations'));
    }

    $url = isset($_POST['artasia_reconcile_url']) ? esc_url_raw(trim((string) $_POST['artasia_reconcile_url'])) : '';
    if ($url) {
        update_option('artasia_reconcile_url', $url);
    } else {
        delete_option('artasia_reconcile_url');
    }

    $secret = isset($_POST['artasia_reconcile_secret']) ? trim((string) $_POST['artasia_reconcile_secret']) : '';
    if ($secret !== '') {
        update_option('artasia_reconcile_secret', $secret);
    }

    wp_safe_redirect(add_query_arg(['post_type' => 'artasia_placement', 'page' => ARTASIA_TOOLS_PAGE_SLUG, 'settings_saved' => '1'], admin_url('edit.php')));
    exit;
}
add_action('admin_post_artasia_save_reconcile_settings', 'artasia_handle_save_reconcile_settings');

function artasia_handle_reconcile_run(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to run reconcile.', 'wp-artasia-locations'));
    }

    if (!isset($_POST['artasia_reconcile_run_nonce']) || !wp_verify_nonce($_POST['artasia_reconcile_run_nonce'], 'artasia_reconcile_run')) {
        wp_die(esc_html__('Invalid reconcile request.', 'wp-artasia-locations'));
    }

    $url = artasia_get_reconcile_url();
    $secret = artasia_get_reconcile_secret();

    if (!$secret) {
        wp_safe_redirect(add_query_arg(['post_type' => 'artasia_placement', 'page' => ARTASIA_TOOLS_PAGE_SLUG, 'reconcile' => 'error', 'message' => 'No secret configured'], admin_url('edit.php')));
        exit;
    }

    $response = wp_remote_post($url, [
        'timeout' => 30,
        'headers' => [
            'x-reconcile-secret' => $secret,
            'Accept' => 'application/json',
        ],
    ]);

    if (is_wp_error($response)) {
        $message = $response->get_error_message() ?: 'WP HTTP error';
        wp_safe_redirect(add_query_arg(['post_type' => 'artasia_placement', 'page' => ARTASIA_TOOLS_PAGE_SLUG, 'reconcile' => 'error', 'message' => rawurlencode($message)], admin_url('edit.php')));
        exit;
    }

    $status_code = wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);

    if ($status_code < 200 || $status_code >= 300) {
        $message = is_array($decoded) && !empty($decoded['error']) ? (string) $decoded['error'] : sprintf('HTTP %d', $status_code);
        wp_safe_redirect(add_query_arg(['post_type' => 'artasia_placement', 'page' => ARTASIA_TOOLS_PAGE_SLUG, 'reconcile' => 'error', 'message' => rawurlencode($message)], admin_url('edit.php')));
        exit;
    }

    $applied = is_array($decoded) && !empty($decoded['applied']) ? 1 : 0;
    $mutations = is_array($decoded) && isset($decoded['mutations']) && is_array($decoded['mutations']) ? count($decoded['mutations']) : 0;

    wp_safe_redirect(add_query_arg(['post_type' => 'artasia_placement', 'page' => ARTASIA_TOOLS_PAGE_SLUG, 'reconcile' => 'success', 'applied' => $applied, 'mutations' => $mutations], admin_url('edit.php')));
    exit;
}
add_action('admin_post_artasia_reconcile_run', 'artasia_handle_reconcile_run');

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
        'place_shared_with' => 'Central Public School',
        'place_latitude' => '43.258',
        'place_longitude' => '-79.872',
        'place_notes' => 'Use main entrance',
        'partner_name' => 'Hamilton Public Library',
        'partner_type' => 'Partner Organization',
        'partner_website' => 'https://www.hpl.ca',
        'partner_brand_color_one' => '#ff6600',
        'partner_brand_color_two' => '#8b160f',
        'partner_notes' => 'Library partner',
        'team_member_name' => 'Taylor Morgan',
        'team_member_role' => 'Artist Educator',
        'team_member_email' => 'taylor@example.org',
        'team_member_notes' => 'Team member notes for this placement',
        'secondary_team_member_name' => 'Jordan Lee',
        'secondary_team_member_role' => 'Artist Educator',
        'secondary_team_member_email' => 'jordan@example.org',
        'secondary_team_member_notes' => 'Supporting team member notes for this placement',
        'program_context' => 'Beyond the Bell',
        'earlyon' => 'no',
        'section' => 'Room 3',
        'delivery_weekday' => 'monday',
        'delivery_start_time' => '09:00',
        'delivery_end_time' => '11:30',
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

function artasia_handle_anecdotes_dry_run(): void
{
    if (!current_user_can('edit_posts')) {
        wp_die(esc_html__('You do not have permission to map Artasia anecdotes.', 'wp-artasia-locations'));
    }

    if (!isset($_POST['artasia_anecdotes_dry_run_nonce']) || !wp_verify_nonce($_POST['artasia_anecdotes_dry_run_nonce'], 'artasia_anecdotes_dry_run')) {
        wp_die(esc_html__('Invalid anecdote dry-run request.', 'wp-artasia-locations'));
    }

    if (empty($_FILES['artasia_anecdotes_csv']['tmp_name']) || !is_uploaded_file($_FILES['artasia_anecdotes_csv']['tmp_name'])) {
        wp_die(esc_html__('Choose an anecdote CSV or TSV file.', 'wp-artasia-locations'));
    }

    $filename = isset($_FILES['artasia_anecdotes_csv']['name'])
        ? sanitize_file_name((string) $_FILES['artasia_anecdotes_csv']['name'])
        : '';
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (!in_array($extension, ['csv', 'tsv'], true)) {
        wp_die(esc_html__('The anecdote file must use a .csv or .tsv extension.', 'wp-artasia-locations'));
    }

    $file_size = intval($_FILES['artasia_anecdotes_csv']['size'] ?? 0);
    if ($file_size > 5 * 1024 * 1024) {
        wp_die(esc_html__('The anecdote file must be 5 MB or smaller.', 'wp-artasia-locations'));
    }

    $dataset = artasia_read_anecdote_csv((string) $_FILES['artasia_anecdotes_csv']['tmp_name']);
    if (!empty($dataset['error'])) {
        wp_die(esc_html($dataset['error']));
    }

    $report_rows = artasia_infer_anecdote_relationships($dataset['rows']);
    artasia_download_anecdote_inference_report($dataset['headers'], $report_rows);
}
add_action('admin_post_artasia_anecdotes_dry_run', 'artasia_handle_anecdotes_dry_run');

function artasia_detect_csv_delimiter(string $path): string
{
    $handle = fopen($path, 'r');
    if (!$handle) {
        return ',';
    }

    $line = fgets($handle);
    fclose($handle);
    if ($line === false) {
        return ',';
    }

    $best_delimiter = ',';
    $best_count = 1;
    foreach ([",", "\t", ";"] as $delimiter) {
        $count = count(str_getcsv($line, $delimiter));
        if ($count > $best_count) {
            $best_count = $count;
            $best_delimiter = $delimiter;
        }
    }

    return $best_delimiter;
}

function artasia_read_anecdote_csv(string $path): array
{
    $delimiter = artasia_detect_csv_delimiter($path);
    $handle = fopen($path, 'r');
    if (!$handle) {
        return ['error' => 'The anecdote file could not be opened.', 'headers' => [], 'rows' => []];
    }

    $source_headers = fgetcsv($handle, 0, $delimiter);
    if (!$source_headers) {
        fclose($handle);
        return ['error' => 'The anecdote file does not contain a header row.', 'headers' => [], 'rows' => []];
    }

    $source_headers = array_map(static function ($header): string {
        return preg_replace('/^\xEF\xBB\xBF/', '', trim((string) $header));
    }, $source_headers);
    $normalized_headers = array_map('artasia_normalize_anecdote_header', $source_headers);
    $required_headers = ['timestamp', 'person', 'site', 'age', 'story'];
    $missing_headers = array_values(array_diff($required_headers, $normalized_headers));
    if ($missing_headers) {
        fclose($handle);
        return [
            'error' => sprintf('The anecdote file is missing required header(s): %s.', implode(', ', $missing_headers)),
            'headers' => [],
            'rows' => [],
        ];
    }

    $rows = [];
    $source_row_number = 1;
    while (($source_row = fgetcsv($handle, 0, $delimiter)) !== false) {
        $source_row_number++;
        if (artasia_import_row_is_empty($source_row)) {
            continue;
        }

        $source_values = [];
        foreach ($source_headers as $index => $unused_header) {
            $source_values[] = isset($source_row[$index]) ? (string) $source_row[$index] : '';
        }
        $rows[] = [
            'source_row' => $source_row_number,
            'source_values' => $source_values,
            'record' => artasia_import_combine_row($normalized_headers, $source_values),
        ];
    }
    fclose($handle);

    if (!$rows) {
        return ['error' => 'The anecdote file does not contain any data rows.', 'headers' => [], 'rows' => []];
    }

    return ['error' => '', 'headers' => $source_headers, 'rows' => $rows];
}

function artasia_normalize_anecdote_header(string $header): string
{
    $normalized = artasia_normalize_import_header($header);
    $aliases = [
        'artasia team member' => 'person',
        'participant ages' => 'age',
        'participant age' => 'age',
        'anecdote' => 'story',
    ];

    return $aliases[$normalized] ?? $normalized;
}

function artasia_anecdote_normalize_match_text(string $value): string
{
    $value = function_exists('remove_accents') ? remove_accents($value) : $value;
    $value = function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    $value = str_replace('&', ' and ', $value);
    $value = preg_replace('/[^a-z0-9]+/u', ' ', $value);

    return trim(preg_replace('/\s+/', ' ', (string) $value));
}

function artasia_anecdote_match_person(string $source_person, array $people): array
{
    $person_names = array_map('trim', explode(',', $source_person));
    $selected_source_person = (string) ($person_names[0] ?? '');
    $additional_names_ignored = count(array_filter(array_slice($person_names, 1))) > 0;
    $selection_note = $additional_names_ignored
        ? sprintf('Used the first comma-separated person, "%s"; additional names were ignored.', $selected_source_person)
        : '';
    $needle = artasia_anecdote_normalize_match_text($selected_source_person);
    if ($needle === '') {
        return ['id' => 0, 'title' => '', 'score' => 0, 'status' => 'missing', 'candidates' => '', 'notes' => 'Person is blank.'];
    }

    $matches = [];
    foreach ($people as $person) {
        $candidate = artasia_anecdote_normalize_match_text((string) $person->post_title);
        if ($candidate === '') {
            continue;
        }

        if ($candidate === $needle) {
            $score = 100;
        } elseif (strpos($candidate, $needle) !== false || strpos($needle, $candidate) !== false) {
            $score = 90;
        } else {
            similar_text($needle, $candidate, $score);
            $score = round($score, 1);
        }
        $matches[] = ['id' => intval($person->ID), 'title' => (string) $person->post_title, 'score' => $score];
    }

    usort($matches, static function (array $left, array $right): int {
        return $right['score'] <=> $left['score'] ?: $left['id'] <=> $right['id'];
    });
    $top = $matches[0] ?? null;
    $runner_up = $matches[1] ?? null;
    $candidate_text = implode('; ', array_map(static function (array $match): string {
        return sprintf('%d: %s [%.1f]', $match['id'], $match['title'], $match['score']);
    }, array_slice($matches, 0, 5)));

    if (!$top || $top['score'] < 75) {
        return [
            'id' => 0,
            'title' => '',
            'score' => $top['score'] ?? 0,
            'status' => 'unmatched',
            'candidates' => $candidate_text,
            'notes' => trim($selection_note . ' No sufficiently similar person was found.'),
        ];
    }

    $ambiguous = $runner_up && $top['score'] - $runner_up['score'] < 5;
    return [
        'id' => $top['id'],
        'title' => $top['title'],
        'score' => $top['score'],
        'status' => $ambiguous ? 'ambiguous' : ($top['score'] === 100 ? 'exact' : 'fuzzy'),
        'candidates' => $candidate_text,
        'notes' => trim(implode(' ', array_filter([
            $selection_note,
            $ambiguous ? 'The top person matches are too close; review the selected ID.' : '',
        ]))),
    ];
}

function artasia_anecdote_text_tokens(string $value): array
{
    $ignored = ['the', 'and', 'at', 'of', 'in', 'on', 'am', 'pm', 'years', 'year', 'old'];
    $tokens = preg_split('/\s+/', artasia_anecdote_normalize_match_text($value), -1, PREG_SPLIT_NO_EMPTY);

    return array_values(array_unique(array_filter($tokens ?: [], static function (string $token) use ($ignored): bool {
        return strlen($token) >= 3 && !in_array($token, $ignored, true);
    })));
}

function artasia_anecdote_extract_weekdays(string $value): array
{
    $normalized = artasia_anecdote_normalize_match_text($value);
    $weekdays = [
        'monday' => ['monday', 'mon'],
        'tuesday' => ['tuesday', 'tue', 'tues'],
        'wednesday' => ['wednesday', 'wed'],
        'thursday' => ['thursday', 'thu', 'thur', 'thurs'],
        'friday' => ['friday', 'fri'],
    ];
    $matches = [];
    foreach ($weekdays as $weekday => $aliases) {
        foreach ($aliases as $alias) {
            if (preg_match('/(?:^|\s)' . preg_quote($alias, '/') . '(?:\s|$)/', $normalized)) {
                $matches[] = $weekday;
                break;
            }
        }
    }

    return $matches;
}

function artasia_anecdote_extract_weekday(string $value): string
{
    $weekdays = artasia_anecdote_extract_weekdays($value);

    return $weekdays[0] ?? '';
}

function artasia_anecdote_extract_times(string $value): array
{
    preg_match_all('/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/i', $value, $matches, PREG_SET_ORDER);
    $minutes = [];
    foreach ($matches as $match) {
        $hour = intval($match[1]);
        $minute = isset($match[2]) && $match[2] !== '' ? intval($match[2]) : 0;
        $meridiem = strtolower(str_replace('.', '', $match[3] ?? ''));
        if ($meridiem === 'pm' && $hour < 12) {
            $hour += 12;
        } elseif ($meridiem === 'am' && $hour === 12) {
            $hour = 0;
        }
        $minutes[] = $hour * 60 + $minute;
    }

    return array_values(array_unique($minutes));
}

function artasia_anecdote_time_matches(string $stored_time, array $source_times): bool
{
    if (!preg_match('/^(\d{1,2}):(\d{2})$/', trim($stored_time), $match)) {
        return false;
    }
    $expected = intval($match[1]) * 60 + intval($match[2]);
    foreach ($source_times as $source_time) {
        $differences = [
            abs($expected - $source_time),
            abs(($expected % 720) - ($source_time % 720)),
        ];
        if (min($differences) <= 15) {
            return true;
        }
    }

    return false;
}

function artasia_anecdote_extract_age_range(string $value): ?array
{
    preg_match_all('/\d+(?:\.\d+)?/', $value, $matches);
    $numbers = array_map('floatval', $matches[0] ?? []);
    if (!$numbers) {
        return null;
    }

    return [min($numbers), max($numbers)];
}

function artasia_anecdote_age_score(string $source_age, string $placement_age): array
{
    if (trim($source_age) === '' || trim($placement_age) === '') {
        return [0, 'age unavailable'];
    }
    if (artasia_anecdote_normalize_match_text($source_age) === artasia_anecdote_normalize_match_text($placement_age)) {
        return [30, 'age exact'];
    }

    $source_range = artasia_anecdote_extract_age_range($source_age);
    $placement_range = artasia_anecdote_extract_age_range($placement_age);
    if (!$source_range || !$placement_range) {
        return [0, 'age text differs'];
    }

    $intersection = max(0, min($source_range[1], $placement_range[1]) - max($source_range[0], $placement_range[0]));
    $union = max($source_range[1], $placement_range[1]) - min($source_range[0], $placement_range[0]);
    if ($union <= 0) {
        return [$source_range[0] === $placement_range[0] ? 30 : -15, 'single age comparison'];
    }
    if ($intersection <= 0) {
        return [-20, 'age ranges do not overlap'];
    }

    $score = (int) round(30 * $intersection / $union);
    return [$score, sprintf('age overlap %.0f%%', 100 * $intersection / $union)];
}

function artasia_anecdote_score_placement(WP_Post $placement, string $source_site, string $source_age): array
{
    $place_id = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
    $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
    $fields = [
        'placement' => (string) $placement->post_title,
        'place' => $place_id ? (string) get_the_title($place_id) : '',
        'partner' => $partner_id ? (string) get_the_title($partner_id) : '',
        'section' => (string) get_post_meta($placement->ID, 'artasia_section', true),
        'program' => (string) get_post_meta($placement->ID, 'artasia_program_context', true),
    ];
    $site_normalized = artasia_anecdote_normalize_match_text($source_site);
    $score = 0;
    $reasons = [];
    $weights = ['placement' => 65, 'place' => 28, 'partner' => 18, 'section' => 14, 'program' => 8];
    foreach ($fields as $label => $field) {
        $field_normalized = artasia_anecdote_normalize_match_text($field);
        if ($field_normalized !== '' && strpos($site_normalized, $field_normalized) !== false) {
            $score += $weights[$label];
            $reasons[] = $label . ' exact';
        }
    }

    $placement_title_tokens = artasia_anecdote_text_tokens($fields['placement']);
    $site_title_tokens = artasia_anecdote_text_tokens($source_site);
    if ($placement_title_tokens) {
        $title_token_overlap = count(array_intersect($placement_title_tokens, $site_title_tokens));
        $title_token_coverage = $title_token_overlap / count($placement_title_tokens);
        $title_token_score = (int) round(35 * $title_token_coverage);
        $score += $title_token_score;
        if ($title_token_score) {
            $reasons[] = sprintf(
                'placement title token coverage %d/%d',
                $title_token_overlap,
                count($placement_title_tokens)
            );
        }
    }

    $placement_title_normalized = artasia_anecdote_normalize_match_text($fields['placement']);
    if ($placement_title_normalized !== '' && strpos($site_normalized, $placement_title_normalized) === 0) {
        $score += 25;
        $reasons[] = 'placement title prefix';
    }

    $source_is_earlyon = preg_match('/(?:^|\s)earlyon(?:\s|$)/', $site_normalized) === 1;
    $placement_earlyon_text = artasia_anecdote_normalize_match_text(implode(' ', [
        $fields['placement'],
        $fields['partner'],
        $fields['program'],
    ]));
    $placement_is_earlyon = (bool) get_post_meta($placement->ID, 'artasia_is_earlyon', true)
        || preg_match('/(?:^|\s)earlyon(?:\s|$)/', $placement_earlyon_text) === 1;
    if ($source_is_earlyon && $placement_is_earlyon) {
        $score += 35;
        $reasons[] = 'EarlyON exact';
    } elseif ($source_is_earlyon !== $placement_is_earlyon) {
        $score -= 25;
        $reasons[] = 'EarlyON differs';
    }

    $site_tokens = artasia_anecdote_text_tokens($source_site);
    $placement_tokens = artasia_anecdote_text_tokens(implode(' ', $fields));
    if ($site_tokens && $placement_tokens) {
        $overlap = count(array_intersect($site_tokens, $placement_tokens));
        $token_score = (int) round(25 * $overlap / count($site_tokens));
        $score += $token_score;
        if ($token_score) {
            $reasons[] = sprintf('site token overlap %d/%d', $overlap, count($site_tokens));
        }
    }

    $source_weekdays = artasia_anecdote_extract_weekdays($source_site);
    $placement_weekday = (string) get_post_meta($placement->ID, 'artasia_delivery_weekday', true);
    if ($source_weekdays && $placement_weekday) {
        if (in_array($placement_weekday, $source_weekdays, true)) {
            $score += 18;
            $reasons[] = count($source_weekdays) > 1 ? 'weekday among listed options' : 'weekday exact';
        } else {
            $score -= 10;
            $reasons[] = 'weekday differs';
        }
    }

    $source_times = artasia_anecdote_extract_times($source_site);
    foreach (['artasia_delivery_start_time' => 'start time', 'artasia_delivery_end_time' => 'end time'] as $meta_key => $label) {
        $stored_time = (string) get_post_meta($placement->ID, $meta_key, true);
        if ($stored_time !== '' && $source_times) {
            if (artasia_anecdote_time_matches($stored_time, $source_times)) {
                $score += 12;
                $reasons[] = $label . ' exact';
            } else {
                $score -= 4;
                $reasons[] = $label . ' differs';
            }
        }
    }

    [$age_score, $age_reason] = artasia_anecdote_age_score(
        $source_age,
        (string) get_post_meta($placement->ID, 'artasia_participant_age', true)
    );
    $score += $age_score;
    $reasons[] = $age_reason;

    return ['score' => $score, 'reasons' => implode(', ', array_filter($reasons))];
}

function artasia_anecdote_match_placement(int $person_id, string $source_site, string $source_age): array
{
    if (!$person_id) {
        return ['id' => 0, 'title' => '', 'project_id' => 0, 'score' => 0, 'status' => 'unmatched', 'candidates' => '', 'notes' => 'A person match is required before placements can be considered.'];
    }

    $placements = get_posts([
        'post_type' => 'artasia_placement',
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
        'meta_query' => [
            'relation' => 'OR',
            ['key' => 'artasia_team_member_id', 'value' => $person_id, 'compare' => '=', 'type' => 'NUMERIC'],
            ['key' => 'artasia_secondary_team_member_id', 'value' => $person_id, 'compare' => '=', 'type' => 'NUMERIC'],
        ],
    ]);
    if (!$placements) {
        return ['id' => 0, 'title' => '', 'project_id' => 0, 'score' => 0, 'status' => 'unmatched', 'candidates' => '', 'notes' => 'The matched person has no primary or secondary placement assignments.'];
    }

    $matches = [];
    foreach ($placements as $placement) {
        $placement_score = artasia_anecdote_score_placement($placement, $source_site, $source_age);
        $matches[] = [
            'id' => intval($placement->ID),
            'title' => (string) $placement->post_title,
            'project_id' => intval(get_post_meta($placement->ID, 'artasia_project_id', true)),
            'score' => $placement_score['score'],
            'reasons' => $placement_score['reasons'],
        ];
    }
    usort($matches, static function (array $left, array $right): int {
        return $right['score'] <=> $left['score'] ?: $left['id'] <=> $right['id'];
    });

    $top = $matches[0];
    $runner_up = $matches[1] ?? null;
    $ambiguous = $runner_up && $top['score'] - $runner_up['score'] < 10;
    $low_confidence = $top['score'] < 30;
    $candidate_text = implode('; ', array_map(static function (array $match): string {
        return sprintf('%d: %s [%d; %s]', $match['id'], $match['title'], $match['score'], $match['reasons']);
    }, $matches));

    return [
        'id' => $top['id'],
        'title' => $top['title'],
        'project_id' => $top['project_id'],
        'score' => $top['score'],
        'status' => $ambiguous ? 'ambiguous' : ($low_confidence ? 'low_confidence' : 'matched'),
        'candidates' => $candidate_text,
        'notes' => $ambiguous
            ? 'The two highest placement scores are close; review the selected ID.'
            : ($low_confidence ? 'The selected placement has a low evidence score; review it.' : ''),
    ];
}

function artasia_anecdote_parse_timestamp(string $value): ?DateTimeImmutable
{
    $timezone = function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('UTC');
    $formats = ['!n/j/Y H:i:s', '!n/j/Y H:i', '!Y-m-d H:i:s', '!Y-m-d H:i', '!n/j/Y'];
    foreach ($formats as $format) {
        $date = DateTimeImmutable::createFromFormat($format, trim($value), $timezone);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
            return $date;
        }
    }

    return null;
}

function artasia_anecdote_activity_hint(string $story): ?array
{
    $normalized = artasia_anecdote_normalize_match_text($story);
    if ($normalized === '') {
        return null;
    }

    if (preg_match('/(?:^|\s)(?:last day|final week)(?:\s|$)/', $normalized)) {
        return [
            'week' => 5,
            'title_term' => 'imagining',
            'basis' => 'Story phrase "last day" or "final week" indicates Week 5 Imagining.',
        ];
    }
    if (preg_match('/(?:^|\s)sound[a-z]*(?:\s|$)/', $normalized)) {
        return [
            'week' => 4,
            'title_term' => 'listening',
            'basis' => 'Story contains "sound", indicating Week 4 Listening.',
        ];
    }
    if (preg_match('/(?:^|\s)(?:smell|scent)[a-z]*(?:\s|$)/', $normalized)) {
        return [
            'week' => 2,
            'title_term' => 'smelling',
            'basis' => 'Story contains "smell" or "scent", indicating Week 2 Smelling.',
        ];
    }

    return null;
}

function artasia_anecdote_activities_for_project(int $project_id): array
{
    if (!$project_id) {
        return [];
    }

    $activities = get_posts([
        'post_type' => 'artasia_activity',
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
        'meta_key' => 'artasia_project_id',
        'meta_value' => $project_id,
        'orderby' => 'title',
        'order' => 'ASC',
    ]);
    $result = [];
    foreach ($activities as $activity) {
        $week = intval(get_post_meta($activity->ID, 'artasia_activity_week', true));
        if ($week < 1) {
            continue;
        }
        $result[] = ['id' => intval($activity->ID), 'title' => (string) $activity->post_title, 'week' => $week];
    }
    usort($result, static function (array $left, array $right): int {
        return $left['week'] <=> $right['week'] ?: strcmp($left['title'], $right['title']) ?: $left['id'] <=> $right['id'];
    });

    return $result;
}

function artasia_infer_anecdote_relationships(array $rows): array
{
    $people = get_posts([
        'post_type' => 'artasia_people',
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
        'orderby' => 'title',
        'order' => 'ASC',
    ]);

    foreach ($rows as $index => $row) {
        $record = $row['record'];
        $person = artasia_anecdote_match_person(artasia_import_value($record, 'person'), $people);
        $placement = artasia_anecdote_match_placement(
            $person['id'],
            artasia_import_value($record, 'site'),
            artasia_import_value($record, 'age')
        );
        $timestamp = artasia_anecdote_parse_timestamp(artasia_import_value($record, 'timestamp'));
        $rows[$index]['person_match'] = $person;
        $rows[$index]['placement_match'] = $placement;
        $rows[$index]['parsed_timestamp'] = $timestamp;
        $rows[$index]['timestamp_date'] = $timestamp ? $timestamp->format('Y-m-d') : '';
    }

    $dates_by_placement = [];
    $project_ids = [];
    foreach ($rows as $row) {
        $project_id = intval($row['placement_match']['project_id']);
        $placement_id = intval($row['placement_match']['id']);
        if ($project_id) {
            $project_ids[$project_id] = true;
        }
        if ($placement_id && $row['timestamp_date']) {
            $dates_by_placement[$placement_id][$row['timestamp_date']] = true;
        }
    }
    foreach ($dates_by_placement as $placement_id => $dates) {
        $ordered_dates = array_keys($dates);
        sort($ordered_dates, SORT_STRING);
        $dates_by_placement[$placement_id] = $ordered_dates;
    }

    $activities_by_project = [];
    foreach (array_keys($project_ids) as $project_id) {
        $activities_by_project[$project_id] = artasia_anecdote_activities_for_project(intval($project_id));
    }

    foreach ($rows as $index => $row) {
        $project_id = intval($row['placement_match']['project_id']);
        $placement_id = intval($row['placement_match']['id']);
        $activity_hint = artasia_anecdote_activity_hint(artasia_import_value($row['record'], 'story'));
        $activity_match = ['id' => 0, 'title' => '', 'week' => 0, 'status' => 'unmatched', 'basis' => '', 'candidates' => '', 'notes' => ''];
        if (!$row['parsed_timestamp'] && !$activity_hint) {
            $activity_match['status'] = 'invalid_timestamp';
            $activity_match['notes'] = 'Timestamp could not be parsed, so chronological activity mapping was not possible.';
        } elseif (!$project_id) {
            $activity_match['status'] = 'missing_project';
            $activity_match['notes'] = 'The inferred placement has no project, so project activities could not be considered.';
        } else {
            $activities = $activities_by_project[$project_id] ?? [];
            $weeks = array_values(array_unique(array_column($activities, 'week')));
            sort($weeks, SORT_NUMERIC);
            $date_index = array_search($row['timestamp_date'], $dates_by_placement[$placement_id] ?? [], true);
            $chronological_week = $date_index !== false && isset($weeks[$date_index]) ? intval($weeks[$date_index]) : 0;
            $inferred_week = $activity_hint ? intval($activity_hint['week']) : $chronological_week;
            $week_candidates = array_values(array_filter($activities, static function (array $activity) use ($inferred_week): bool {
                return $inferred_week > 0 && $activity['week'] === $inferred_week;
            }));
            $preferred_candidates = $activity_hint
                ? array_values(array_filter($week_candidates, static function (array $activity) use ($activity_hint): bool {
                    return strpos(
                        artasia_anecdote_normalize_match_text($activity['title']),
                        $activity_hint['title_term']
                    ) !== false;
                }))
                : [];
            $candidates = $preferred_candidates ?: $week_candidates;
            $activity_match['week'] = $inferred_week;
            $activity_match['basis'] = $activity_hint
                ? $activity_hint['basis']
                : ($chronological_week ? 'Submission-date order within the inferred placement.' : '');
            $activity_match['candidates'] = implode('; ', array_map(static function (array $activity): string {
                return sprintf('%d: %s [week %d]', $activity['id'], $activity['title'], $activity['week']);
            }, $candidates));
            if (!$activities) {
                $activity_match['status'] = 'no_project_activities';
                $activity_match['notes'] = 'No activities with week numbers were found for the inferred project.';
            } elseif (!$inferred_week) {
                $activity_match['status'] = 'skipped_activity_limit';
                $activity_match['notes'] = 'Activity assignment was skipped because this placement has more distinct anecdote dates than the project has configured activity weeks.';
            } elseif (!$candidates) {
                $activity_match['status'] = 'no_activity_for_week';
                $activity_match['notes'] = sprintf('No activity was found for inferred week %d.', $inferred_week);
            } else {
                $activity_match['id'] = $candidates[0]['id'];
                $activity_match['title'] = $candidates[0]['title'];
                $activity_match['status'] = count($candidates) > 1
                    ? 'ambiguous'
                    : ($activity_hint ? 'matched_content_hint' : 'matched');
                $activity_match['notes'] = count($candidates) > 1
                    ? sprintf('Multiple activities use week %d; review the selected ID.', $inferred_week)
                    : ($activity_hint && !$preferred_candidates
                        ? sprintf('The story indicated week %d, but no activity title contained "%s"; the only week match was used.', $inferred_week, $activity_hint['title_term'])
                        : '');
            }
        }
        $rows[$index]['activity_match'] = $activity_match;
    }

    return $rows;
}

function artasia_anecdote_report_headers(): array
{
    return [
        'source_row',
        'normalized_timestamp',
        'inferred_person_id',
        'inferred_person_name',
        'person_match_status',
        'person_match_score',
        'person_candidates',
        'inferred_placement_id',
        'inferred_placement_name',
        'placement_match_status',
        'placement_match_score',
        'placement_candidates',
        'inferred_project_id',
        'inferred_activity_week',
        'inferred_activity_id',
        'inferred_activity_name',
        'activity_inference_basis',
        'activity_match_status',
        'activity_candidates',
        'inference_status',
        'inference_notes',
    ];
}

function artasia_anecdote_report_values(array $row): array
{
    $person = $row['person_match'];
    $placement = $row['placement_match'];
    $activity = $row['activity_match'];
    $statuses = [$person['status'], $placement['status'], $activity['status']];
    $ready = !array_intersect($statuses, ['missing', 'unmatched', 'invalid_timestamp', 'missing_project', 'no_project_activities', 'skipped_activity_limit', 'no_activity_for_week']);
    $review = (bool) array_intersect($statuses, ['ambiguous', 'low_confidence']);
    $notes = array_values(array_filter([$person['notes'], $placement['notes'], $activity['notes']]));

    return [
        $row['source_row'],
        $row['parsed_timestamp'] ? $row['parsed_timestamp']->format(DateTimeInterface::ATOM) : '',
        $person['id'],
        $person['title'],
        $person['status'],
        $person['score'],
        $person['candidates'],
        $placement['id'],
        $placement['title'],
        $placement['status'],
        $placement['score'],
        $placement['candidates'],
        $placement['project_id'],
        $activity['week'],
        $activity['id'],
        $activity['title'],
        $activity['basis'],
        $activity['status'],
        $activity['candidates'],
        !$ready ? 'unmatched' : ($review ? 'review' : 'ready'),
        implode(' ', $notes),
    ];
}

function artasia_download_anecdote_inference_report(array $source_headers, array $rows): void
{
    nocache_headers();
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="artasia-anecdote-inference-' . gmdate('Y-m-d-His') . '.csv"');

    $output = fopen('php://output', 'w');
    fwrite($output, "\xEF\xBB\xBF");
    fputcsv($output, array_merge($source_headers, artasia_anecdote_report_headers()));
    foreach ($rows as $row) {
        fputcsv($output, array_merge($row['source_values'], artasia_anecdote_report_values($row)));
    }
    fclose($output);
    exit;
}

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
    $secondary_team_member_id = 0;
    $secondary_team_member_name = artasia_import_value($record, 'secondary_team_member_name');
    if ($secondary_team_member_name) {
        $secondary_team_member_id = artasia_import_find_or_create_post('artasia_people', $secondary_team_member_name);
    }

    if (!$project_id || !$place_id || !$partner_id || ($team_member_name && !$team_member_id) || ($secondary_team_member_name && !$secondary_team_member_id)) {
        return 'error';
    }

    update_post_meta($project_id, 'artasia_project_year', $project_year);
    artasia_import_update_meta_if_present($project_id, 'artasia_project_description', $record, 'project_description', 'sanitize_textarea_field');

    artasia_import_update_meta_if_present($place_id, 'artasia_address', $record, 'place_street_address', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_city', $record, 'place_city', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_postal_code', $record, 'place_postal_code', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_shared_with', $record, 'place_shared_with', 'sanitize_text_field');
    artasia_import_update_meta_if_present($place_id, 'artasia_lat', $record, 'place_latitude', 'floatval');
    artasia_import_update_meta_if_present($place_id, 'artasia_lng', $record, 'place_longitude', 'floatval');
    artasia_import_update_meta_if_present($place_id, 'artasia_accessibility_notes', $record, 'place_notes', 'sanitize_textarea_field');

    artasia_import_update_meta_if_present($partner_id, 'artasia_partner_type', $record, 'partner_type', 'sanitize_text_field');
    artasia_import_update_meta_if_present($partner_id, 'artasia_website', $record, 'partner_website', 'esc_url_raw');
    artasia_import_update_meta_if_present($partner_id, 'artasia_brand_color_one', $record, 'partner_brand_color_one', 'artasia_sanitize_hex_color_meta');
    artasia_import_update_meta_if_present($partner_id, 'artasia_brand_color_two', $record, 'partner_brand_color_two', 'artasia_sanitize_hex_color_meta');
    artasia_import_update_meta_if_present($partner_id, 'artasia_notes', $record, 'partner_notes', 'sanitize_textarea_field');

    if ($team_member_id) {
        update_post_meta($team_member_id, 'artasia_role', sanitize_text_field(artasia_import_value($record, 'team_member_role') ?: 'Artist Educator'));
        artasia_import_update_meta_if_present($team_member_id, 'artasia_email', $record, 'team_member_email', 'sanitize_email');
        artasia_import_update_meta_if_present($team_member_id, 'artasia_notes', $record, 'team_member_notes', 'sanitize_textarea_field');
    }
    if ($secondary_team_member_id) {
        update_post_meta($secondary_team_member_id, 'artasia_role', sanitize_text_field(artasia_import_value($record, 'secondary_team_member_role') ?: 'Artist Educator'));
        artasia_import_update_meta_if_present($secondary_team_member_id, 'artasia_email', $record, 'secondary_team_member_email', 'sanitize_email');
        artasia_import_update_meta_if_present($secondary_team_member_id, 'artasia_notes', $record, 'secondary_team_member_notes', 'sanitize_textarea_field');
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
    if ($secondary_team_member_id) {
        update_post_meta($placement_id, 'artasia_secondary_team_member_id', $secondary_team_member_id);
    }
    update_post_meta($placement_id, 'artasia_program_context', sanitize_text_field(artasia_import_value($record, 'program_context')));
    update_post_meta($placement_id, 'artasia_is_earlyon', artasia_import_boolean(artasia_import_value($record, 'earlyon')));
    update_post_meta($placement_id, 'artasia_section', sanitize_text_field($section));
    update_post_meta($placement_id, 'artasia_delivery_weekday', artasia_sanitize_placement_weekday(artasia_import_value($record, 'delivery_weekday')));
    update_post_meta($placement_id, 'artasia_delivery_start_time', artasia_sanitize_placement_time(artasia_import_value($record, 'delivery_start_time')));
    update_post_meta($placement_id, 'artasia_delivery_end_time', artasia_sanitize_placement_time(artasia_import_value($record, 'delivery_end_time')));
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
        'place_shared_with',
        'place_latitude',
        'place_longitude',
        'place_notes',
        'partner_name',
        'partner_type',
        'partner_website',
        'partner_brand_color_one',
        'partner_brand_color_two',
        'partner_notes',
        'team_member_name',
        'team_member_role',
        'team_member_email',
        'team_member_notes',
        'secondary_team_member_name',
        'secondary_team_member_role',
        'secondary_team_member_email',
        'secondary_team_member_notes',
        'program_context',
        'earlyon',
        'section',
        'delivery_weekday',
        'delivery_start_time',
        'delivery_end_time',
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
        'page' => ARTASIA_TOOLS_PAGE_SLUG,
        'imported' => intval($result['imported'] ?? 0),
        'skipped' => intval($result['skipped'] ?? 0),
        'errors' => intval($result['errors'] ?? 0),
    ], admin_url('edit.php')));
    exit;
}
