<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_team_shortcode($attributes): string
{
    $attributes = shortcode_atts([
        'year' => '',
    ], $attributes, 'artasia_team');

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

    $project_id = intval($projects[0]);
    $team = [];

    $placements = get_posts([
        'post_type'      => 'artasia_placement',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'meta_key'       => 'artasia_project_id',
        'meta_value'     => $project_id,
        'fields'         => 'ids',
        'no_found_rows'  => true,
    ]);

    foreach ($placements as $placement_id) {
        foreach (['artasia_team_member_id', 'artasia_secondary_team_member_id'] as $meta_key) {
            $person_id = intval(get_post_meta($placement_id, $meta_key, true));
            if (!$person_id) {
                continue;
            }

            $responsibility = get_post_meta($person_id, 'artasia_role', true) ?: 'Artist Educator';
            artasia_add_team_responsibility($team, $person_id, $responsibility, PHP_INT_MAX);
        }
    }

    $roles = get_posts([
        'post_type'      => 'artasia_role',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'meta_key'       => 'artasia_project_id',
        'meta_value'     => $project_id,
        'orderby'        => 'title',
        'order'          => 'ASC',
        'fields'         => 'ids',
        'no_found_rows'  => true,
    ]);

    foreach ($roles as $role_id) {
        $person_id = intval(get_post_meta($role_id, 'artasia_person_id', true));
        $responsibility = get_the_title($role_id);
        $order = intval(get_post_meta($role_id, 'artasia_role_order', true));

        if ($person_id && $responsibility) {
            artasia_add_team_responsibility($team, $person_id, $responsibility, $order);
        }
    }

    if (!$team) {
        return '';
    }

    $people = get_posts([
        'post_type'      => 'artasia_people',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
        'post__in'       => array_keys($team),
        'meta_query'     => [[
            'key'     => 'artasia_publish_profile',
            'value'   => '1',
            'compare' => '=',
        ]],
        'orderby'        => 'title',
        'order'          => 'ASC',
        'no_found_rows'  => true,
    ]);

    if (!$people) {
        return '';
    }

    usort($people, static function (WP_Post $a, WP_Post $b): int {
        $a_name_parts = array_values(array_filter(explode(' ', trim($a->post_title)), 'strlen'));
        $b_name_parts = array_values(array_filter(explode(' ', trim($b->post_title)), 'strlen'));
        $a_last_name = $a_name_parts ? $a_name_parts[count($a_name_parts) - 1] : '';
        $b_last_name = $b_name_parts ? $b_name_parts[count($b_name_parts) - 1] : '';
        $last_name_comparison = strcasecmp($a_last_name, $b_last_name);

        return $last_name_comparison ?: strcasecmp($a->post_title, $b->post_title);
    });

    ob_start();
?>
    <section class="artasia-team" data-artasia-year="<?php echo esc_attr($year); ?>">
        <?php foreach ($people as $person) : ?>
            <?php
            $photo_id = intval(get_post_meta($person->ID, 'artasia_photo_id', true));
            $pronouns = get_post_meta($person->ID, 'artasia_pronouns', true);
            $bio = get_post_meta($person->ID, 'artasia_bio', true);
            $instagram = get_post_meta($person->ID, 'artasia_instagram', true);
            $portfolio_url = get_post_meta($person->ID, 'artasia_portfolio_url', true);
            $portfolio_label = preg_replace('#^https?://#i', '', $portfolio_url);
            $edit_url = is_user_logged_in() && current_user_can('edit_post', $person->ID)
                ? get_edit_post_link($person->ID, '')
                : '';
            ?>
            <article class="artasia-team__member<?php echo $photo_id ? ' has-photo' : ''; ?>">
                <?php if ($photo_id) : ?>
                    <div class="artasia-team__photo">
                        <?php echo wp_get_attachment_image($photo_id, 'medium', false, ['loading' => 'lazy']); ?>
                    </div>
                <?php endif; ?>
                <div class="artasia-team__content">
                    <h3 class="artasia-team__name">
                        <?php echo esc_html($person->post_title); ?>
                    </h3>
                    <?php if ($pronouns) : ?>
                        <p class="artasia-team__pronouns"><?php echo esc_html($pronouns); ?></p>
                    <?php endif; ?>
                    <p class="artasia-team__roles">
                        <?php echo esc_html(implode(', ', array_keys($team[$person->ID]['responsibilities']))); ?>
                    </p>
                    <?php if ($bio) : ?>
                        <div class="artasia-team__bio"><?php echo wp_kses_post(wpautop($bio)); ?></div>
                    <?php endif; ?>
                    <?php if ($instagram || $portfolio_url) : ?>
                        <p class="artasia-team__links">
                            <?php if ($instagram) : ?>
                                <span class="artasia-team__link">
                                    <strong>Instagram</strong>
                                    <a href="<?php echo esc_url('https://www.instagram.com/' . rawurlencode($instagram) . '/'); ?>" rel="noopener noreferrer" target="_blank">
                                        @<?php echo esc_html($instagram); ?>
                                    </a>
                                </span>
                            <?php endif; ?>
                            <?php if ($portfolio_url) : ?>
                                <span class="artasia-team__link">
                                    <strong>Portfolio</strong>
                                    <a class="artasia-team__portfolio-link" href="<?php echo esc_url($portfolio_url); ?>" rel="noopener noreferrer" target="_blank"><?php echo esc_html($portfolio_label); ?></a>
                                </span>
                            <?php endif; ?>
                        </p>
                    <?php endif; ?>
                    <?php if ($edit_url) : ?>
                        <p class="artasia-team__edit">
                            <a href="<?php echo esc_url($edit_url); ?>">Edit profile</a>
                        </p>
                    <?php endif; ?>
                </div>
            </article>
        <?php endforeach; ?>
    </section>
<?php

    return trim((string) ob_get_clean());
}
add_shortcode('artasia_team', 'artasia_team_shortcode');

function artasia_add_team_responsibility(array &$team, int $person_id, string $responsibility, int $order): void
{
    if (!isset($team[$person_id])) {
        $team[$person_id] = [
            'order'            => $order,
            'responsibilities' => [],
        ];
    }

    $team[$person_id]['order'] = min($team[$person_id]['order'], $order);
    $team[$person_id]['responsibilities'][$responsibility] = true;
}
