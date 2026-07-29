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
            <h1 class="artasia-documentation__title"><?php echo esc_html($document->post_title); ?></h1>
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

function artasia_render_documentation_directory(array $groups, int $selected_id = 0, bool $compact = false): string
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
                                href="<?php echo esc_url(get_permalink($document)); ?>"
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

    wp_enqueue_style('artasia-documentation-shortcode');

    ob_start();
?>
    <section class="artasia-documentation artasia-documentation--index">
        <?php echo artasia_render_documentation_directory($groups); ?>
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

function artasia_render_single_documentation(WP_Post $document): string
{
    $context = artasia_get_documentation_context($document);
    $groups = $context['project_id'] ? artasia_get_project_documentation($context['project_id']) : [];
    $related = [];

    foreach ($groups as $group) {
        if (intval($group['partner_id']) !== intval($context['partner_id'])) {
            continue;
        }
        foreach ($group['documents'] as $entry) {
            if ($entry['document']->ID !== $document->ID) {
                $related[] = $entry['document'];
            }
        }
        break;
    }

    $back_url = $context['index_page_id'] && get_post_status($context['index_page_id']) === 'publish'
        ? get_permalink($context['index_page_id'])
        : ($context['project_id'] ? get_permalink($context['project_id']) : '');

    wp_enqueue_style('artasia-documentation-shortcode');

    ob_start();
?>
    <section class="artasia-documentation artasia-documentation--single">
        <?php if ($back_url) : ?>
            <a class="artasia-documentation__back" href="<?php echo esc_url($back_url); ?>">&larr; Back</a>
        <?php endif; ?>
        <?php echo artasia_render_documentation_article($document, $context['partner_name'], $context); ?>

        <?php if ($related) : ?>
            <aside class="artasia-documentation__related">
                <h2>More from this partner</h2>
                <ul>
                    <?php foreach ($related as $related_document) : ?>
                        <li><a href="<?php echo esc_url(get_permalink($related_document)); ?>"><?php echo esc_html($related_document->post_title); ?></a></li>
                    <?php endforeach; ?>
                </ul>
            </aside>
        <?php endif; ?>

        <?php if ($groups) : ?>
            <div class="artasia-documentation__all">
                <?php echo artasia_render_documentation_directory($groups, $document->ID, true); ?>
            </div>
        <?php endif; ?>
    </section>
<?php

    return trim((string) ob_get_clean());
}
