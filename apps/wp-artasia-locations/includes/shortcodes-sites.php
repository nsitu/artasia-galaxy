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

    foreach ($placements as $placement) {
        $partner_id = intval(get_post_meta($placement->ID, 'artasia_partner_id', true));
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
                                ?>
                                <li><?php echo esc_html($placement_label); ?></li>
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
