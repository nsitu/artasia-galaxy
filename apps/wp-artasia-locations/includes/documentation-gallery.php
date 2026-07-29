<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_render_documentation_gallery(int $post_id): string
{
    $gallery_ids = artasia_validate_image_attachment_ids(
        get_post_meta($post_id, 'artasia_documentation_gallery_ids', true)
    );

    if (!$gallery_ids) {
        return '';
    }

    static $gallery_instance = 0;
    $gallery_instance++;
    $gallery_id = 'artasia-documentation-gallery-' . $post_id . '-' . $gallery_instance;

    ob_start();
?>
    <section id="<?php echo esc_attr($gallery_id); ?>" class="artasia-documentation-gallery" aria-label="Documentation gallery">
        <div class="artasia-documentation-gallery__grid">
            <?php foreach ($gallery_ids as $index => $attachment_id) : ?>
                <?php
                $full_url = wp_get_attachment_image_url($attachment_id, 'full');
                $caption = wp_get_attachment_caption($attachment_id);
                if (!$full_url) {
                    continue;
                }
                ?>
                <figure class="artasia-documentation-gallery__item">
                    <a
                        class="artasia-documentation-gallery__trigger"
                        href="<?php echo esc_url($full_url); ?>"
                        data-gallery-index="<?php echo esc_attr($index); ?>"
                        aria-label="<?php echo esc_attr(sprintf('Open image %d of %d', $index + 1, count($gallery_ids))); ?>"
                    >
                        <?php
                        echo wp_get_attachment_image($attachment_id, 'large', false, [
                            'class'   => 'artasia-documentation-gallery__thumbnail',
                            'loading' => 'lazy',
                        ]);
                        ?>
                    </a>
                    <?php if ($caption) : ?>
                        <figcaption class="artasia-documentation-gallery__caption"><?php echo wp_kses_post($caption); ?></figcaption>
                    <?php endif; ?>
                </figure>
            <?php endforeach; ?>
        </div>
        <dialog class="artasia-documentation-lightbox" aria-label="Image viewer">
            <button type="button" class="artasia-documentation-lightbox__close" aria-label="Close image viewer">&times;</button>
            <button type="button" class="artasia-documentation-lightbox__previous" aria-label="Previous image">&lsaquo;</button>
            <div class="artasia-documentation-lightbox__content">
                <img class="artasia-documentation-lightbox__image" alt="">
                <p class="artasia-documentation-lightbox__caption" hidden></p>
            </div>
            <button type="button" class="artasia-documentation-lightbox__next" aria-label="Next image">&rsaquo;</button>
        </dialog>
    </section>
<?php

    return (string) ob_get_clean();
}

function artasia_append_documentation_gallery(string $content): string
{
    if (!is_singular('artasia_document') || !in_the_loop() || !is_main_query()) {
        return $content;
    }

    return $content . artasia_render_documentation_gallery((int) get_the_ID());
}
add_filter('the_content', 'artasia_append_documentation_gallery', 20);

function artasia_enqueue_documentation_gallery_assets(): void
{
    if (!is_singular('artasia_document')) {
        return;
    }

    wp_enqueue_style(
        'artasia-documentation-gallery',
        ARTASIA_LOCATIONS_URL . 'assets/documentation-gallery.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_enqueue_script(
        'artasia-documentation-gallery',
        ARTASIA_LOCATIONS_URL . 'assets/documentation-gallery.js',
        [],
        ARTASIA_LOCATIONS_VERSION,
        true
    );
}
add_action('wp_enqueue_scripts', 'artasia_enqueue_documentation_gallery_assets');
