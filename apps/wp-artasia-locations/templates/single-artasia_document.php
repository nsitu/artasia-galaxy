<?php

if (!defined('ABSPATH')) {
    exit;
}

get_header();
?>
<main id="primary" class="site-main artasia-documentation-template">
    <?php while (have_posts()) : ?>
        <?php the_post(); ?>
        <?php echo artasia_render_single_documentation(get_post()); ?>
    <?php endwhile; ?>
</main>
<?php
get_footer();
