<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_sites_shortcode($attributes): string
{
    $attributes = shortcode_atts([
        'year' => '',
    ], $attributes, 'artasia_sites');

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
        'fields'          => 'ids',
        'no_found_rows'   => true,
    ]);

    if (!$projects) {
        return '';
    }

    return artasia_render_sites(intval($projects[0]));
}
add_shortcode('artasia_sites', 'artasia_sites_shortcode');

function artasia_get_gallery_availability(): ?array
{
    $fresh_cache_key = 'artasia_gallery_availability';
    $stale_cache_key = 'artasia_gallery_availability_stale';
    $cached = get_transient($fresh_cache_key);

    if (is_array($cached)) {
        return $cached;
    }

    $endpoint = apply_filters(
        'artasia_gallery_availability_url',
        'https://galaxy.artsforall.co/api/v1/placements/gallery-availability'
    );
    $response = wp_remote_get($endpoint, [
        'timeout'     => 3,
        'redirection' => 2,
        'headers'     => [
            'Accept' => 'application/json',
        ],
    ]);

    if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
        $payload = json_decode(wp_remote_retrieve_body($response), true);
        if (is_array($payload) && isset($payload['placements']) && is_array($payload['placements'])) {
            $availability = [];
            foreach ($payload['placements'] as $placement_id => $has_gallery) {
                $placement_id = intval($placement_id);
                if ($placement_id > 0) {
                    $availability[(string) $placement_id] = (bool) $has_gallery;
                }
            }

            set_transient($fresh_cache_key, $availability, 5 * MINUTE_IN_SECONDS);
            set_transient($stale_cache_key, $availability, DAY_IN_SECONDS);

            return $availability;
        }
    }

    $stale = get_transient($stale_cache_key);

    return is_array($stale) ? $stale : null;
}

function artasia_render_sites(int $project_id): string
{
    if (get_post_type($project_id) !== 'artasia_project' || get_post_status($project_id) !== 'publish') {
        return '';
    }

    $placements = get_posts([
        'post_type'      => 'artasia_placement',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'meta_query'     => [
            [
                'key'     => 'artasia_project_id',
                'value'   => $project_id,
                'compare' => '=',
            ],
            [
                'key'     => 'artasia_publish_site',
                'value'   => '1',
                'compare' => '=',
            ],
        ],
        'orderby'        => 'title',
        'order'          => 'ASC',
        'no_found_rows'  => true,
    ]);

    if (!$placements) {
        return '';
    }

    $groups = [];
    $partner_ids = [];
    $place_ids = [];

    foreach ($placements as $placement) {
        $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
        $place_id = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
        $group_key = $partner_id ?: 0;

        if (!isset($groups[$group_key])) {
            $groups[$group_key] = [
                'partner_id' => $partner_id,
                'sites'      => [],
            ];
        }

        $groups[$group_key]['sites'][] = $placement;
        if ($partner_id) {
            $partner_ids[$partner_id] = $partner_id;
        }
        if ($place_id) {
            $place_ids[$place_id] = $place_id;
        }
    }

    $place_lookup = [];
    if ($place_ids) {
        $places = get_posts([
            'post_type'      => 'artasia_place',
            'posts_per_page' => -1,
            'post_status'    => 'publish',
            'post__in'       => array_values($place_ids),
            'no_found_rows'  => true,
        ]);

        foreach ($places as $place) {
            $street_address = trim((string) get_post_meta($place->ID, 'artasia_address', true));
            $city = trim((string) get_post_meta($place->ID, 'artasia_city', true));
            $postal_code = trim((string) get_post_meta($place->ID, 'artasia_postal_code', true));
            $city_postal = trim($city . ($postal_code !== '' ? ' ' . $postal_code : ''));

            $place_lookup[$place->ID] = [
                'name'    => $place->post_title,
                'address' => implode(', ', array_filter([$street_address, $city_postal], 'strlen')),
            ];
        }
    }

    $documentation_lookup = [];
    $documentation_posts = get_posts([
        'post_type'      => 'artasia_document',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'orderby'        => [
            'date'  => 'ASC',
            'title' => 'ASC',
        ],
        'no_found_rows'  => true,
    ]);
    foreach ($documentation_posts as $documentation) {
        $documentation_placement_ids = artasia_sanitize_integer_array_meta(
            get_post_meta($documentation->ID, 'artasia_documentation_placement_ids', true)
        );
        foreach ($documentation_placement_ids as $documentation_placement_id) {
            if (!isset($documentation_lookup[$documentation_placement_id])) {
                $documentation_lookup[$documentation_placement_id] = $documentation;
            }
        }
    }

    $partner_lookup = [];
    if ($partner_ids) {
        $partners = get_posts([
            'post_type'      => 'artasia_partner',
            'posts_per_page' => -1,
            'post_status'    => 'publish',
            'post__in'       => array_values($partner_ids),
            'orderby'        => 'title',
            'order'          => 'ASC',
            'no_found_rows'  => true,
        ]);

        foreach ($partners as $partner) {
            $partner_lookup[$partner->ID] = $partner;
        }
    }

    foreach ($groups as $group_key => $group) {
        if ($group['partner_id'] && !isset($partner_lookup[$group['partner_id']])) {
            if (!isset($groups[0])) {
                $groups[0] = [
                    'partner_id' => 0,
                    'sites'      => [],
                ];
            }

            $groups[0]['sites'] = array_merge($groups[0]['sites'], $group['sites']);
            unset($groups[$group_key]);
        }
    }

    foreach ($groups as &$group) {
        usort($group['sites'], static function (WP_Post $a, WP_Post $b): int {
            return strcasecmp($a->post_title, $b->post_title);
        });
    }
    unset($group);

    uasort($groups, static function (array $a, array $b) use ($partner_lookup): int {
        $a_name = $a['partner_id'] ? $partner_lookup[$a['partner_id']]->post_title : 'Other sites';
        $b_name = $b['partner_id'] ? $partner_lookup[$b['partner_id']]->post_title : 'Other sites';

        return strcasecmp($a_name, $b_name);
    });

    if (!$groups) {
        return '';
    }

    $year = intval(get_post_meta($project_id, 'artasia_project_year', true));
    $documentation_page_id = intval(get_post_meta($project_id, 'artasia_documentation_page_id', true));
    $documentation_base_url = $documentation_page_id && get_post_status($documentation_page_id) === 'publish'
        ? get_permalink($documentation_page_id)
        : '';
    $gallery_availability = artasia_get_gallery_availability();

    ob_start();
?>
    <section class="artasia-sites" data-artasia-year="<?php echo esc_attr($year); ?>">
        <div class="artasia-sites__inner">
            <?php foreach ($groups as $group) : ?>
                <?php
                $partner = $group['partner_id'] ? $partner_lookup[$group['partner_id']] : null;
                $partner_name = $partner ? $partner->post_title : 'Other sites';
                $logo_id = $partner ? intval(get_post_meta($partner->ID, 'artasia_logo_id', true)) : 0;
                ?>
                <section class="artasia-sites__partner<?php echo $logo_id ? ' has-logo' : ''; ?>">
                    <?php if ($logo_id) : ?>
                        <div class="artasia-sites__partner-logo">
                            <?php echo wp_get_attachment_image($logo_id, 'large', false, ['loading' => 'lazy']); ?>
                        </div>
                    <?php endif; ?>
                    <div class="artasia-sites__partner-content">
                        <h2 class="artasia-sites__partner-name"><?php echo esc_html($partner_name); ?></h2>
                        <ul class="artasia-sites__list">
                            <?php foreach ($group['sites'] as $placement) : ?>
                                <?php
                                $section = trim((string) get_post_meta($placement->ID, 'artasia_section', true));
                                $placement_label = $placement->post_title
                                    . ($section !== '' ? ' — ' . $section : '');
                                $galaxy_url = 'https://galaxy.artsforall.co/sites/' . rawurlencode($placement->post_name);
                                $place_id = intval(get_post_meta($placement->ID, 'artasia_place_id', true));
                                $place = $place_lookup[$place_id] ?? null;
                                $documentation = $documentation_lookup[$placement->ID] ?? null;
                                $show_gallery = $gallery_availability === null
                                    || !empty($gallery_availability[(string) $placement->ID]);
                                ?>
                                <li>
                                    <span class="artasia-sites__placement-name"><?php echo esc_html($placement_label); ?></span>
                                    <?php if ($place) : ?>
                                        <span class="artasia-sites__place-name"><?php echo esc_html($place['name']); ?></span>
                                        <?php if ($place['address'] !== '') : ?>
                                            <span class="artasia-sites__place-address"><?php echo esc_html($place['address']); ?></span>
                                        <?php endif; ?>
                                    <?php endif; ?>
                                    <?php if ($show_gallery || ($documentation && $documentation_base_url)) : ?>
                                        <div class="artasia-sites__actions">
                                            <?php if ($show_gallery) : ?>
                                                <a class="artasia-sites__action" href="<?php echo esc_url($galaxy_url); ?>">Gallery</a>
                                            <?php endif; ?>
                                            <?php if ($documentation && $documentation_base_url) : ?>
                                                <a class="artasia-sites__action" href="<?php echo esc_url(add_query_arg('documentation', $documentation->post_name, $documentation_base_url)); ?>">Documentation</a>
                                            <?php endif; ?>
                                        </div>
                                    <?php endif; ?>
                                </li>
                            <?php endforeach; ?>
                        </ul>
                    </div>
                </section>
            <?php endforeach; ?>
        </div>
    </section>
<?php

    return trim((string) ob_get_clean());
}
