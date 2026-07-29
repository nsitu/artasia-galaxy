<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_documentation_shortcode($attributes): string
{
    $attributes = shortcode_atts([
        'year'       => '',
        'project_id' => '',
    ], $attributes, 'artasia_documentation');

    $project_id = intval($attributes['project_id']);
    if (!$project_id) {
        $year = intval($attributes['year']);
        if ($year < 1900 || $year > 2200) {
            return '';
        }

        $projects = get_posts([
            'post_type'      => 'artasia_project',
            'posts_per_page' => 1,
            'post_status'    => 'publish',
            'meta_query'     => [[
                'key'     => 'artasia_project_year',
                'value'   => $year,
                'compare' => '=',
                'type'    => 'NUMERIC',
            ]],
            'fields'         => 'ids',
            'no_found_rows'  => true,
        ]);
        $project_id = intval($projects[0] ?? 0);
    }

    return artasia_render_documentation_viewer($project_id);
}
add_shortcode('artasia_documentation', 'artasia_documentation_shortcode');

function artasia_get_project_documentation(int $project_id): array
{
    if (get_post_type($project_id) !== 'artasia_project' || get_post_status($project_id) !== 'publish') {
        return [];
    }

    $placements = get_posts([
        'post_type'      => 'artasia_placement',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'meta_key'       => 'artasia_project_id',
        'meta_value'     => $project_id,
        'fields'         => 'ids',
        'no_found_rows'  => true,
    ]);
    if (!$placements) {
        return [];
    }

    $placement_lookup = [];
    $partner_ids = [];
    foreach ($placements as $placement_id) {
        $partner_id = intval(get_post_meta($placement_id, 'artasia_partner_id', true));
        $placement_lookup[$placement_id] = $partner_id;
        if ($partner_id) {
            $partner_ids[$partner_id] = $partner_id;
        }
    }

    $partner_names = [];
    if ($partner_ids) {
        $partners = get_posts([
            'post_type'      => 'artasia_partner',
            'posts_per_page' => -1,
            'post_status'    => 'publish',
            'post__in'       => array_values($partner_ids),
            'no_found_rows'  => true,
        ]);
        foreach ($partners as $partner) {
            $partner_names[$partner->ID] = $partner->post_title;
        }
    }

    $documents = get_posts([
        'post_type'      => 'artasia_document',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'title',
        'order'          => 'ASC',
        'no_found_rows'  => true,
    ]);

    $groups = [];
    foreach ($documents as $document) {
        $document_placements = artasia_sanitize_integer_array_meta(
            get_post_meta($document->ID, 'artasia_documentation_placement_ids', true)
        );
        $matching_placements = array_values(array_intersect($document_placements, $placements));
        if (!$matching_placements) {
            continue;
        }

        $document_partner_names = [];
        foreach ($matching_placements as $placement_id) {
            $partner_id = $placement_lookup[$placement_id] ?? 0;
            if ($partner_id && isset($partner_names[$partner_id])) {
                $document_partner_names[$partner_id] = $partner_names[$partner_id];
            }
        }

        if ($document_partner_names) {
            natcasesort($document_partner_names);
            $partner_name = (string) reset($document_partner_names);
            $partner_id = intval(key($document_partner_names));
        } else {
            $partner_id = 0;
            $partner_name = 'Other documentation';
        }

        $placement_names = [];
        foreach ($matching_placements as $placement_id) {
            $placement_partner_id = $placement_lookup[$placement_id] ?? 0;
            if ($placement_partner_id === $partner_id || (!$partner_id && !$placement_partner_id)) {
                $placement_names[] = get_the_title($placement_id);
            }
        }
        if (!$placement_names) {
            $placement_names = array_map('get_the_title', $matching_placements);
        }
        natcasesort($placement_names);
        $placement_name = (string) reset($placement_names);

        if (!isset($groups[$partner_id])) {
            $groups[$partner_id] = [
                'partner_id'   => $partner_id,
                'partner_name' => $partner_name,
                'documents'    => [],
            ];
        }
        $groups[$partner_id]['documents'][] = [
            'document'       => $document,
            'placement_name' => $placement_name,
        ];
    }

    uasort($groups, static function (array $a, array $b): int {
        if (!$a['partner_id']) {
            return 1;
        }
        if (!$b['partner_id']) {
            return -1;
        }
        return strcasecmp($a['partner_name'], $b['partner_name']);
    });

    return array_values($groups);
}

function artasia_find_project_documentation(array $groups, string $slug): ?WP_Post
{
    foreach ($groups as $group) {
        foreach ($group['documents'] as $entry) {
            $document = $entry['document'];
            if ($document->post_name === $slug) {
                return $document;
            }
        }
    }

    return null;
}

function artasia_render_documentation_article(WP_Post $document, string $partner_name = ''): string
{
    $pull_quote = get_post_meta($document->ID, 'artasia_documentation_pull_quote', true);
    $content = apply_filters('the_content', $document->post_content);

    ob_start();
?>
    <article class="artasia-documentation__article" data-documentation-id="<?php echo esc_attr($document->ID); ?>">
        <header class="artasia-documentation__header">
            <?php if ($partner_name && $partner_name !== 'Other documentation') : ?>
                <p class="artasia-documentation__partner"><?php echo esc_html($partner_name); ?></p>
            <?php endif; ?>
            <h2 class="artasia-documentation__title" tabindex="-1"><?php echo esc_html($document->post_title); ?></h2>
            <?php if ($pull_quote) : ?>
                <blockquote class="artasia-documentation__pull-quote"><?php echo esc_html($pull_quote); ?></blockquote>
            <?php endif; ?>
        </header>
        <div class="artasia-documentation__body"><?php echo $content; ?></div>
        <?php echo artasia_render_documentation_gallery($document->ID); ?>
    </article>
<?php

    return trim((string) ob_get_clean());
}

function artasia_render_documentation_viewer(int $project_id): string
{
    $groups = artasia_get_project_documentation($project_id);
    if (!$groups) {
        return '';
    }

    $requested_slug = isset($_GET['documentation'])
        ? sanitize_title(wp_unslash($_GET['documentation']))
        : '';
    $selected = $requested_slug ? artasia_find_project_documentation($groups, $requested_slug) : null;
    if (!$selected) {
        $selected = $groups[0]['documents'][0]['document'];
    }

    $selected_partner = '';
    foreach ($groups as $group) {
        foreach ($group['documents'] as $entry) {
            $document = $entry['document'];
            if ($document->ID === $selected->ID) {
                $selected_partner = $group['partner_name'];
                break 2;
            }
        }
    }

    wp_enqueue_style('artasia-documentation-gallery');
    wp_enqueue_script('artasia-documentation-gallery');
    wp_enqueue_style('artasia-documentation-shortcode');
    wp_enqueue_script('artasia-documentation-shortcode');

    $rest_base = rest_url('artasia/v1/documentation/');
    $base_url = remove_query_arg('documentation');

    ob_start();
?>
    <section
        class="artasia-documentation"
        data-project-id="<?php echo esc_attr($project_id); ?>"
        data-rest-base="<?php echo esc_url($rest_base); ?>"
    >
        <nav class="artasia-documentation__navigation" aria-label="Documentation">
            <h2 class="artasia-documentation__navigation-title">Documentation</h2>
            <?php foreach ($groups as $group) : ?>
                <section class="artasia-documentation__navigation-group">
                    <?php $logo_id = $group['partner_id'] ? intval(get_post_meta($group['partner_id'], 'artasia_logo_id', true)) : 0; ?>
                    <?php if ($logo_id) : ?>
                        <div class="artasia-documentation__navigation-logo">
                            <?php echo wp_get_attachment_image($logo_id, 'medium', false, ['loading' => 'lazy']); ?>
                        </div>
                    <?php endif; ?>
                    <h3><?php echo esc_html($group['partner_name']); ?></h3>
                    <ul>
                        <?php foreach ($group['documents'] as $entry) : ?>
                            <?php $document = $entry['document']; ?>
                            <li>
                                <a
                                    href="<?php echo esc_url(add_query_arg('documentation', $document->post_name, $base_url)); ?>"
                                    data-documentation-slug="<?php echo esc_attr($document->post_name); ?>"
                                    <?php echo $document->ID === $selected->ID ? 'aria-current="page"' : ''; ?>
                                >
                                    <span class="artasia-documentation__navigation-document-title"><?php echo esc_html($document->post_title); ?></span>
                                    <?php if ($entry['placement_name']) : ?>
                                        <span class="artasia-documentation__navigation-placement"><?php echo esc_html($entry['placement_name']); ?></span>
                                    <?php endif; ?>
                                </a>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                </section>
            <?php endforeach; ?>
        </nav>
        <div class="artasia-documentation__viewer">
            <p class="artasia-documentation__status screen-reader-text" aria-live="polite"></p>
            <div class="artasia-documentation__content">
                <?php echo artasia_render_documentation_article($selected, $selected_partner); ?>
            </div>
        </div>
    </section>
<?php

    return trim((string) ob_get_clean());
}

function artasia_register_documentation_rest_routes(): void
{
    register_rest_route('artasia/v1', '/documentation/(?P<slug>[a-z0-9-]+)', [
        'methods'             => 'GET',
        'callback'            => 'artasia_rest_get_documentation',
        'permission_callback' => '__return_true',
        'args'                => [
            'project_id' => [
                'required'          => true,
                'sanitize_callback' => 'absint',
                'validate_callback' => static function ($value): bool {
                    return intval($value) > 0;
                },
            ],
        ],
    ]);
}
add_action('rest_api_init', 'artasia_register_documentation_rest_routes');

function artasia_rest_get_documentation(WP_REST_Request $request)
{
    $project_id = intval($request->get_param('project_id'));
    $slug = sanitize_title($request->get_param('slug'));
    $groups = artasia_get_project_documentation($project_id);
    $document = artasia_find_project_documentation($groups, $slug);

    if (!$document) {
        return new WP_Error('artasia_documentation_not_found', 'Documentation not found.', ['status' => 404]);
    }

    $partner_name = '';
    foreach ($groups as $group) {
        foreach ($group['documents'] as $entry) {
            $group_document = $entry['document'];
            if ($group_document->ID === $document->ID) {
                $partner_name = $group['partner_name'];
                break 2;
            }
        }
    }

    return rest_ensure_response([
        'id'        => $document->ID,
        'slug'      => $document->post_name,
        'title'     => $document->post_title,
        'permalink' => get_permalink($document),
        'html'      => artasia_render_documentation_article($document, $partner_name),
    ]);
}

function artasia_documentation_canonical_url(string $canonical_url, WP_Post $post): string
{
    if (empty($_GET['documentation'])) {
        return $canonical_url;
    }

    $slug = sanitize_title(wp_unslash($_GET['documentation']));
    $document = get_page_by_path($slug, OBJECT, 'artasia_document');

    return $document && $document->post_status === 'publish'
        ? get_permalink($document)
        : $canonical_url;
}
add_filter('get_canonical_url', 'artasia_documentation_canonical_url', 10, 2);
