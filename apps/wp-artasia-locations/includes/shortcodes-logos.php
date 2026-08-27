<?php

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Render partner and supporter logo grids.
 *
 * The renderer is shared by the shortcode and Elementor widget so both
 * integrations remain visually and functionally consistent.
 */
function artasia_logos_shortcode($attributes): string
{
    $attributes = shortcode_atts([
        'partner_heading'   => 'Partners',
        'supporter_heading' => 'Supporters',
        'variant'           => 'colour',
        'project_id'        => '',
    ], $attributes, 'artasia_logos');

    return artasia_render_logos([
        'partner_heading'   => (string) $attributes['partner_heading'],
        'supporter_heading' => (string) $attributes['supporter_heading'],
        'variant'           => (string) $attributes['variant'],
        'project_id'        => absint($attributes['project_id']),
    ]);
}
add_shortcode('artasia_logos', 'artasia_logos_shortcode');

function artasia_normalize_logo_variant(string $variant): string
{
    $variant = strtolower(trim($variant));

    return $variant === 'white' ? 'white' : 'colour';
}

/**
 * Get an attachment's artwork aspect ratio.
 *
 * WordPress usually provides dimensions for raster images. SVG uploads do not
 * consistently have attachment metadata, so fall back to the SVG viewBox (or
 * width/height) when necessary.
 */
function artasia_get_logo_aspect_ratio(int $attachment_id): float
{
    $cache_key = 'logo_aspect_ratio_' . $attachment_id;
    $cached_ratio = wp_cache_get($cache_key, 'artasia_logos');
    if ($cached_ratio !== false) {
        return (float) $cached_ratio;
    }

    $image = wp_get_attachment_image_src($attachment_id, 'full');
    if (is_array($image) && !empty($image[1]) && !empty($image[2])) {
        $ratio = (float) $image[1] / (float) $image[2];
        wp_cache_set($cache_key, $ratio, 'artasia_logos', HOUR_IN_SECONDS);

        return $ratio;
    }

    $metadata = wp_get_attachment_metadata($attachment_id);
    if (is_array($metadata) && !empty($metadata['width']) && !empty($metadata['height'])) {
        $ratio = (float) $metadata['width'] / (float) $metadata['height'];
        wp_cache_set($cache_key, $ratio, 'artasia_logos', HOUR_IN_SECONDS);

        return $ratio;
    }

    if (get_post_mime_type($attachment_id) === 'image/svg+xml') {
        $file = get_attached_file($attachment_id);
        if ($file && is_readable($file)) {
            $svg = file_get_contents($file, false, null, 0, 65536);
            if (is_string($svg)) {
                $number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
                $viewbox_pattern = '/<svg\\b[^>]*\\bviewBox\\s*=\\s*["\\\']\\s*(' . $number . ')\\s+('
                    . $number . ')\\s+(' . $number . ')\\s+(' . $number . ')["\\\']/i';

                if (preg_match($viewbox_pattern, $svg, $matches) && (float) $matches[3] > 0 && (float) $matches[4] > 0) {
                    $ratio = (float) $matches[3] / (float) $matches[4];
                    wp_cache_set($cache_key, $ratio, 'artasia_logos', HOUR_IN_SECONDS);

                    return $ratio;
                }

                $dimension_pattern = '/<svg\\b[^>]*\\bwidth\\s*=\\s*["\\\']\\s*(' . $number . ')[^"\\\']*["\\\'][^>]*\\bheight\\s*=\\s*["\\\']\\s*('
                    . $number . ')[^"\\\']*["\\\']/i';
                if (preg_match($dimension_pattern, $svg, $matches) && (float) $matches[1] > 0 && (float) $matches[2] > 0) {
                    $ratio = (float) $matches[1] / (float) $matches[2];
                    wp_cache_set($cache_key, $ratio, 'artasia_logos', HOUR_IN_SECONDS);

                    return $ratio;
                }
            }
        }
    }

    // A square fallback keeps rendering safe when an attachment has no usable dimensions.
    wp_cache_set($cache_key, 1.0, 'artasia_logos', HOUR_IN_SECONDS);

    return 1.0;
}

/**
 * Calculate the default optical reduction for a logo in the fixed stage.
 */
function artasia_get_logo_optical_scale(float $logo_ratio): float
{
    $stage_ratio = 5 / 3;
    if ($logo_ratio <= 0) {
        return 1.0;
    }

    // This is the maximum area utilization when the logo is fitted with contain.
    $similarity = min($logo_ratio / $stage_ratio, $stage_ratio / $logo_ratio);
    $similarity = max(0.0, min(1.0, $similarity));

    // Logos whose aspect ratio closely matches the stage have greater apparent weight.
    $scale = 1 - (0.16 * pow($similarity, 2));

    return max(0.84, min(1.0, $scale));
}

function artasia_get_logo_grid_item(WP_Post $post, string $variant): ?array
{
    $colour_logo_id = intval(get_post_meta($post->ID, 'artasia_logo_id', true));
    $white_logo_id = intval(get_post_meta($post->ID, 'artasia_white_logo_id', true));
    $variant = artasia_normalize_logo_variant($variant);

    $logo_id = $variant === 'white' ? $white_logo_id : $colour_logo_id;
    $actual_variant = $variant;

    // Keep an incomplete record visible by falling back to its other logo.
    if (!$logo_id) {
        $logo_id = $variant === 'white' ? $colour_logo_id : $white_logo_id;
        $actual_variant = $variant === 'white' ? 'colour' : 'white';
    }

    if (!$logo_id || !wp_attachment_is_image($logo_id)) {
        return null;
    }

    $image = wp_get_attachment_image($logo_id, 'full', false, [
        'class'    => 'artasia-logo-grid__image',
        'alt'      => $post->post_title,
        'loading'  => 'lazy',
        'decoding' => 'async',
    ]);

    if (!$image) {
        return null;
    }

    return [
        'id'             => $post->ID,
        'name'           => $post->post_title,
        'image'          => $image,
        'variant'        => $actual_variant,
        'website'        => (string) get_post_meta($post->ID, 'artasia_website', true),
        'optical_scale'  => artasia_get_logo_optical_scale(artasia_get_logo_aspect_ratio($logo_id)),
    ];
}

function artasia_get_logo_grid_items(string $post_type, string $variant, int $project_id = 0): array
{
    $project_supporter_ids = $post_type === 'artasia_supporter' && $project_id
        ? artasia_get_project_supporter_ids($project_id)
        : [];
    $posts = get_posts([
        'post_type'      => $post_type,
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => 'title',
        'order'          => 'ASC',
        'no_found_rows'  => true,
    ]);

    $items = [];
    $items_by_id = [];
    foreach ($posts as $post) {
        if (
            $post_type === 'artasia_supporter'
            && $project_id
            && !in_array($post->ID, $project_supporter_ids, true)
        ) {
            continue;
        }

        $item = artasia_get_logo_grid_item($post, $variant);
        if ($item !== null) {
            if ($post_type === 'artasia_supporter' && $project_id) {
                $items_by_id[$post->ID] = $item;
            } else {
                $items[] = $item;
            }
        }
    }

    if ($post_type === 'artasia_supporter' && $project_id) {
        foreach ($project_supporter_ids as $supporter_id) {
            if (isset($items_by_id[$supporter_id])) {
                $items[] = $items_by_id[$supporter_id];
            }
        }
    }

    return $items;
}

function artasia_get_project_supporter_ids(int $project_id): array
{
    $recognitions = get_posts([
        'post_type'      => 'artasia_recognition',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'meta_query'     => [[
            'key'     => 'artasia_project_id',
            'value'   => $project_id,
            'compare' => '=',
        ]],
        'fields'         => 'ids',
        'no_found_rows'  => true,
    ]);
    $supporter_rows = [];
    foreach ($recognitions as $recognition_id) {
        $supporter_id = intval(get_post_meta($recognition_id, 'artasia_supporter_id', true));
        if (
            !$supporter_id
            || get_post_type($supporter_id) !== 'artasia_supporter'
            || get_post_status($supporter_id) !== 'publish'
        ) {
            continue;
        }

        $supporter_rows[] = [
            'id'    => $supporter_id,
            'order' => intval(get_post_meta($recognition_id, 'artasia_recognition_order', true)),
        ];
    }

    usort($supporter_rows, static function (array $a, array $b): int {
        $order_comparison = $a['order'] <=> $b['order'];
        if ($order_comparison !== 0) {
            return $order_comparison;
        }

        return strcasecmp(get_the_title($a['id']), get_the_title($b['id']));
    });

    $supporter_ids = [];
    foreach ($supporter_rows as $row) {
        if (!in_array($row['id'], $supporter_ids, true)) {
            $supporter_ids[] = $row['id'];
        }
    }

    return $supporter_ids;
}

function artasia_group_supporter_logo_items(array $items): array
{
    $groups = [];

    foreach ($items as $item) {
        $type = trim((string) get_post_meta($item['id'], 'artasia_supporter_type', true));
        $group_key = $type !== '' ? $type : 'Other';

        if (!isset($groups[$group_key])) {
            $groups[$group_key] = [];
        }

        $groups[$group_key][] = $item;
    }

    uksort($groups, static function (string $a, string $b): int {
        $type_order = [
            'Government' => 0,
            'Foundation' => 1,
            'Sponsor'    => 2,
            'Donor'      => 3,
            'Other'      => 4,
        ];
        $a_order = $type_order[$a] ?? 4;
        $b_order = $type_order[$b] ?? 4;
        if ($a_order !== $b_order) {
            return $a_order <=> $b_order;
        }

        return strcasecmp($a, $b);
    });

    return $groups;
}

function artasia_render_logo_grid(array $items): void
{
    if (!$items) {
        return;
    }
    ?>
    <ul class="artasia-logo-grid">
        <?php foreach ($items as $item) : ?>
            <li class="artasia-logo-grid__item artasia-logo-grid__item--<?php echo esc_attr($item['variant']); ?>">
                <?php if ($item['website'] !== '') : ?>
                    <a class="artasia-logo-grid__link" href="<?php echo esc_url($item['website']); ?>" target="_blank" rel="noopener noreferrer">
                        <span class="artasia-logo-grid__stage" style="--artasia-logo-optical-scale: <?php echo esc_attr(number_format((float) $item['optical_scale'], 4, '.', '')); ?>;">
                            <?php echo $item['image']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Generated by wp_get_attachment_image(). ?>
                        </span>
                    </a>
                <?php else : ?>
                    <span class="artasia-logo-grid__link">
                        <span class="artasia-logo-grid__stage" style="--artasia-logo-optical-scale: <?php echo esc_attr(number_format((float) $item['optical_scale'], 4, '.', '')); ?>;">
                            <?php echo $item['image']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Generated by wp_get_attachment_image(). ?>
                        </span>
                    </span>
                <?php endif; ?>
            </li>
        <?php endforeach; ?>
    </ul>
    <?php
}

function artasia_render_logos(array $args = []): string
{
    $args = wp_parse_args($args, [
        'partner_heading'   => 'Partners',
        'supporter_heading' => 'Supporters',
        'variant'           => 'colour',
        'project_id'        => 0,
    ]);

    $variant = artasia_normalize_logo_variant((string) $args['variant']);
    $project_id = absint($args['project_id']);
    if (
        $project_id
        && (
            get_post_type($project_id) !== 'artasia_project'
            || get_post_status($project_id) !== 'publish'
        )
    ) {
        return '';
    }

    $partners = artasia_get_logo_grid_items('artasia_partner', $variant);
    $supporter_groups = artasia_group_supporter_logo_items(
        artasia_get_logo_grid_items('artasia_supporter', $variant, $project_id)
    );

    if (!$partners && !$supporter_groups) {
        return '';
    }

    wp_enqueue_style('artasia-logos-shortcode');

    ob_start();
    ?>
    <section class="artasia-logo-sections artasia-logo-sections--<?php echo esc_attr($variant); ?>">
        <div class="artasia-logo-sections__inner">
            <?php if ($supporter_groups) : ?>
                <section class="artasia-logo-section artasia-logo-section--supporters">
                    <h2 class="artasia-logo-section__heading"><?php echo esc_html((string) $args['supporter_heading']); ?></h2>
                    <?php foreach ($supporter_groups as $type => $items) : ?>
                        <section class="artasia-logo-group">
                            <h3 class="artasia-logo-group__heading"><?php echo esc_html($type); ?></h3>
                            <?php artasia_render_logo_grid($items); ?>
                        </section>
                    <?php endforeach; ?>
                </section>
            <?php endif; ?>

            <?php if ($partners) : ?>
                <section class="artasia-logo-section artasia-logo-section--partners">
                    <h2 class="artasia-logo-section__heading"><?php echo esc_html((string) $args['partner_heading']); ?></h2>
                    <?php artasia_render_logo_grid($partners); ?>
                </section>
            <?php endif; ?>
        </div>
    </section>
    <?php

    return trim((string) ob_get_clean());
}
