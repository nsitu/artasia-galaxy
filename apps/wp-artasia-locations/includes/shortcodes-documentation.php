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

function artasia_render_documentation_article(WP_Post $document, string $partner_name = '', array $context = []): string
{
    $pull_quote = get_post_meta($document->ID, 'artasia_documentation_pull_quote', true);
    $people_ids = artasia_validate_related_post_ids(
        get_post_meta($document->ID, 'artasia_documentation_people_ids', true),
        'artasia_people'
    );
    $people_names = array_values(array_filter(array_map('get_the_title', $people_ids)));
    $edit_url = is_user_logged_in() && current_user_can('edit_post', $document->ID)
        ? get_edit_post_link($document->ID, '')
        : '';
    $gallery_url = !empty($context['placement_id'])
        ? artasia_get_placement_gallery_url(
            intval($context['placement_id']),
            artasia_get_gallery_availability()
        )
        : '';
    remove_filter('the_content', 'artasia_append_documentation_gallery', 20);
    $content = apply_filters('the_content', $document->post_content);
    add_filter('the_content', 'artasia_append_documentation_gallery', 20);

    ob_start();
?>
    <article class="artasia-documentation__article" data-documentation-id="<?php echo esc_attr($document->ID); ?>">
        <header class="artasia-documentation__header">
            <?php if ($partner_name && $partner_name !== 'Other documentation') : ?>
                <p class="artasia-documentation__partner"><?php echo esc_html($partner_name); ?></p>
            <?php endif; ?>
            <div class="artasia-documentation__title-row">
                <h2 class="artasia-documentation__title" tabindex="-1"><?php echo esc_html($document->post_title); ?></h2>
                <?php if ($edit_url) : ?>
                    <a class="artasia-documentation__edit-button" href="<?php echo esc_url($edit_url); ?>">Edit documentation</a>
                <?php endif; ?>
            </div>
            <?php if ($people_names) : ?>
                <p class="artasia-documentation__people">
                    <span>Documentation by</span>
                    <strong><?php echo esc_html(implode(', ', $people_names)); ?></strong>
                </p>
            <?php endif; ?>
            <?php if (!empty($context['placement_label'])) : ?>
                <p class="artasia-documentation__placement"><?php echo esc_html($context['placement_label']); ?></p>
            <?php endif; ?>
            <?php if (!empty($context['place_name']) || !empty($context['place_address'])) : ?>
                <p class="artasia-documentation__place">
                    <?php if (!empty($context['place_name'])) : ?>
                        <strong><?php echo esc_html($context['place_name']); ?></strong>
                    <?php endif; ?>
                    <?php if (!empty($context['place_address'])) : ?>
                        <span><?php echo esc_html($context['place_address']); ?></span>
                    <?php endif; ?>
                </p>
            <?php endif; ?>
            <?php if ($gallery_url) : ?>
                <p class="artasia-documentation__actions">
                    <a class="artasia-documentation__action" href="<?php echo esc_url($gallery_url); ?>" target="_blank" rel="noopener noreferrer">Gallery</a>
                </p>
            <?php endif; ?>
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

function artasia_render_documentation_directory(array $groups, string $base_url, int $selected_id = 0, bool $compact = false): string
{
    ob_start();
?>
    <nav class="artasia-documentation__navigation<?php echo $compact ? ' artasia-documentation__navigation--compact' : ''; ?>" aria-label="<?php echo esc_attr($compact ? 'All documentation' : 'Documentation'); ?>">
        <?php foreach ($groups as $group) : ?>
            <?php if ($compact) : ?>
                <details class="artasia-documentation__navigation-group" data-partner-id="<?php echo esc_attr($group['partner_id']); ?>">
                    <summary><?php echo esc_html($group['partner_name']); ?></summary>
            <?php else : ?>
                <section class="artasia-documentation__navigation-group" data-partner-id="<?php echo esc_attr($group['partner_id']); ?>">
            <?php endif; ?>
                <?php $logo_id = $group['partner_id'] ? intval(get_post_meta($group['partner_id'], 'artasia_logo_id', true)) : 0; ?>
                <?php if ($logo_id && !$compact) : ?>
                    <div class="artasia-documentation__navigation-logo">
                        <?php echo wp_get_attachment_image($logo_id, 'medium', false, ['loading' => 'lazy']); ?>
                    </div>
                <?php endif; ?>
                <?php if (!$compact) : ?>
                    <h3><?php echo esc_html($group['partner_name']); ?></h3>
                <?php endif; ?>
                <ul>
                    <?php foreach ($group['documents'] as $entry) : ?>
                        <?php $document = $entry['document']; ?>
                        <li>
                            <a
                                href="<?php echo esc_url(add_query_arg('documentation', $document->post_name, $base_url)); ?>"
                                data-documentation-slug="<?php echo esc_attr($document->post_name); ?>"
                                data-documentation-id="<?php echo esc_attr($document->ID); ?>"
                                data-partner-id="<?php echo esc_attr($group['partner_id']); ?>"
                                <?php echo $document->ID === $selected_id ? 'aria-current="page"' : ''; ?>
                            >
                                <span class="artasia-documentation__navigation-document-title"><?php echo esc_html($document->post_title); ?></span>
                                <?php if ($entry['placement_name']) : ?>
                                    <span class="artasia-documentation__navigation-placement"><?php echo esc_html($entry['placement_name']); ?></span>
                                <?php endif; ?>
                            </a>
                        </li>
                    <?php endforeach; ?>
                </ul>
            <?php if ($compact) : ?>
                </details>
            <?php else : ?>
                </section>
            <?php endif; ?>
        <?php endforeach; ?>
    </nav>
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
    $selected = null;
    $selected_partner = '';
    $selected_partner_id = 0;
    $selected_partner_document_count = 0;

    foreach ($groups as $group) {
        foreach ($group['documents'] as $entry) {
            if ($requested_slug && $entry['document']->post_name === $requested_slug) {
                $selected = $entry['document'];
                $selected_partner = $group['partner_name'];
                $selected_partner_id = intval($group['partner_id']);
                $selected_partner_document_count = count($group['documents']);
                break 2;
            }
        }
    }

    $documentation_page_id = intval(get_post_meta($project_id, 'artasia_documentation_page_id', true));
    $base_url = $documentation_page_id && get_post_status($documentation_page_id) === 'publish'
        ? get_permalink($documentation_page_id)
        : remove_query_arg('documentation');

    wp_enqueue_style('artasia-documentation-shortcode');
    wp_enqueue_style('artasia-documentation-gallery');
    wp_enqueue_script('artasia-documentation-gallery');
    wp_enqueue_script('artasia-documentation-shortcode');

    static $viewer_instance = 0;
    $viewer_instance++;
    $related_title_id = sprintf('artasia-documentation-related-title-%d-%d', $project_id, $viewer_instance);

    ob_start();
?>
    <section
        class="artasia-documentation"
        data-project-id="<?php echo esc_attr($project_id); ?>"
        data-rest-base="<?php echo esc_url(rest_url('artasia/v1/documentation/')); ?>"
    >
        <div class="artasia-documentation__directory" <?php echo $selected ? 'hidden' : ''; ?>>
            <?php echo artasia_render_documentation_directory($groups, $base_url); ?>
        </div>
        <div class="artasia-documentation__viewer" <?php echo $selected ? '' : 'hidden'; ?>>
            <p class="artasia-documentation__status screen-reader-text" aria-live="polite"></p>
            <a class="artasia-documentation__back" href="<?php echo esc_url($base_url); ?>" data-documentation-back>&larr; Back</a>
            <div class="artasia-documentation__content">
                <?php if ($selected) : ?>
                    <?php echo artasia_render_documentation_article($selected, $selected_partner, artasia_get_documentation_context($selected)); ?>
                <?php endif; ?>
            </div>
            <aside class="artasia-documentation__related" aria-labelledby="<?php echo esc_attr($related_title_id); ?>" <?php echo $selected_partner_document_count > 1 ? '' : 'hidden'; ?>>
                <h2 id="<?php echo esc_attr($related_title_id); ?>">More from this partner</h2>
                <ul>
                    <?php if ($selected) : ?>
                        <?php foreach ($groups as $group) : ?>
                            <?php if (intval($group['partner_id']) !== $selected_partner_id) continue; ?>
                            <?php foreach ($group['documents'] as $entry) : ?>
                                <?php $related_document = $entry['document']; ?>
                                <?php if ($related_document->ID === $selected->ID) continue; ?>
                                <li>
                                    <a
                                        href="<?php echo esc_url(add_query_arg('documentation', $related_document->post_name, $base_url)); ?>"
                                        data-documentation-slug="<?php echo esc_attr($related_document->post_name); ?>"
                                        data-documentation-id="<?php echo esc_attr($related_document->ID); ?>"
                                        data-partner-id="<?php echo esc_attr($group['partner_id']); ?>"
                                    ><?php echo esc_html($related_document->post_title); ?></a>
                                </li>
                            <?php endforeach; ?>
                            <?php break; ?>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </ul>
            </aside>
            <div class="artasia-documentation__all">
                <?php echo artasia_render_documentation_directory($groups, $base_url, $selected ? $selected->ID : 0, true); ?>
            </div>
        </div>
    </section>
<?php

    return trim((string) ob_get_clean());
}

function artasia_get_documentation_context(WP_Post $document): array
{
    $placement_ids = artasia_validate_related_post_ids(
        get_post_meta($document->ID, 'artasia_documentation_placement_ids', true),
        'artasia_placement'
    );
    $placement_id = intval($placement_ids[0] ?? 0);
    $project_id = $placement_id ? intval(get_post_meta($placement_id, 'artasia_project_id', true)) : 0;
    $partner_id = $placement_id ? intval(get_post_meta($placement_id, 'artasia_partner_id', true)) : 0;
    $place_id = $placement_id ? intval(get_post_meta($placement_id, 'artasia_place_id', true)) : 0;

    $placement_label = '';
    if ($placement_id) {
        $section = trim((string) get_post_meta($placement_id, 'artasia_section', true));
        $placement_label = get_the_title($placement_id) . ($section !== '' ? ' — ' . $section : '');
    }

    $street_address = $place_id ? trim((string) get_post_meta($place_id, 'artasia_address', true)) : '';
    $city = $place_id ? trim((string) get_post_meta($place_id, 'artasia_city', true)) : '';
    $postal_code = $place_id ? trim((string) get_post_meta($place_id, 'artasia_postal_code', true)) : '';
    $city_postal = trim($city . ($postal_code !== '' ? ' ' . $postal_code : ''));

    return [
        'placement_id'    => $placement_id,
        'placement_label' => $placement_label,
        'project_id'      => $project_id,
        'partner_id'      => $partner_id,
        'partner_name'    => $partner_id ? get_the_title($partner_id) : '',
        'place_name'      => $place_id ? get_the_title($place_id) : '',
        'place_address'   => implode(', ', array_filter([$street_address, $city_postal], 'strlen')),
        'index_page_id'   => $project_id ? intval(get_post_meta($project_id, 'artasia_documentation_page_id', true)) : 0,
    ];
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
    $document = null;
    $partner_name = '';

    foreach ($groups as $group) {
        foreach ($group['documents'] as $entry) {
            if ($entry['document']->post_name === $slug) {
                $document = $entry['document'];
                $partner_name = $group['partner_name'];
                break 2;
            }
        }
    }

    if (!$document) {
        return new WP_Error('artasia_documentation_not_found', 'Documentation not found.', ['status' => 404]);
    }

    return rest_ensure_response([
        'id'    => $document->ID,
        'slug'  => $document->post_name,
        'title' => $document->post_title,
        'html'  => artasia_render_documentation_article(
            $document,
            $partner_name,
            artasia_get_documentation_context($document)
        ),
    ]);
}

function artasia_documentation_canonical_url(string $canonical_url, WP_Post $post): string
{
    if ($post->post_type !== 'page' || empty($_GET['documentation'])) {
        return $canonical_url;
    }

    $slug = sanitize_title(wp_unslash($_GET['documentation']));
    $document = get_page_by_path($slug, OBJECT, 'artasia_document');
    if (!$document || $document->post_status !== 'publish') {
        return $canonical_url;
    }

    $context = artasia_get_documentation_context($document);
    if (intval($context['index_page_id']) !== $post->ID) {
        return $canonical_url;
    }

    return add_query_arg('documentation', $document->post_name, get_permalink($post));
}
add_filter('get_canonical_url', 'artasia_documentation_canonical_url', 10, 2);

function artasia_documentation_document_title(array $title): array
{
    if (empty($_GET['documentation'])) {
        return $title;
    }

    $slug = sanitize_title(wp_unslash($_GET['documentation']));
    $document = get_page_by_path($slug, OBJECT, 'artasia_document');
    $context = $document ? artasia_get_documentation_context($document) : [];
    if (
        $document
        && $document->post_status === 'publish'
        && intval($context['index_page_id'] ?? 0) === get_queried_object_id()
    ) {
        $title['title'] = $document->post_title;
    }

    return $title;
}
add_filter('document_title_parts', 'artasia_documentation_document_title');
