<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_render_atlas_documentation_gallery(int $post_id): string
{
    $placement_ids = artasia_validate_related_post_ids(
        get_post_meta($post_id, 'artasia_documentation_placement_ids', true),
        'artasia_placement'
    );
    $placement_id = intval($placement_ids[0] ?? 0);
    if (!$placement_id) {
        return '';
    }

    static $gallery_instance = 0;
    $gallery_instance++;
    $gallery_id = 'artasia-documentation-gallery-' . $post_id . '-' . $gallery_instance;
    $endpoint = rest_url('artasia/v1/documentation/' . $post_id . '/process-gallery');

    return sprintf(
        '<section id="%1$s" class="artasia-documentation-gallery artasia-documentation-gallery--atlas" data-atlas-endpoint="%2$s" aria-label="Documentation gallery"><p class="screen-reader-text" data-gallery-status aria-live="polite">Loading process gallery.</p></section>',
        esc_attr($gallery_id),
        esc_url($endpoint)
    );
}

function artasia_append_documentation_gallery(string $content): string
{
    if (!is_singular('artasia_document') || !in_the_loop() || !is_main_query()) {
        return $content;
    }

    return $content . artasia_render_atlas_documentation_gallery((int) get_the_ID());
}
add_filter('the_content', 'artasia_append_documentation_gallery', 20);

function artasia_enqueue_documentation_gallery_assets(): void
{
    wp_register_style(
        'artasia-documentation-gallery',
        ARTASIA_LOCATIONS_URL . 'assets/documentation-gallery.css',
        [],
        ARTASIA_LOCATIONS_VERSION
    );
    wp_register_script(
        'artasia-documentation-gallery',
        ARTASIA_LOCATIONS_URL . 'assets/documentation-gallery.js',
        [],
        ARTASIA_LOCATIONS_VERSION,
        true
    );

    if (is_singular('artasia_document')) {
        wp_enqueue_style('artasia-documentation-gallery');
        wp_enqueue_script('artasia-documentation-gallery');
    }
}
add_action('wp_enqueue_scripts', 'artasia_enqueue_documentation_gallery_assets');

function artasia_documentation_gallery_rest_routes(): void
{
    register_rest_route('artasia/v1', '/documentation/(?P<document_id>\d+)/process-gallery', [
        'methods'             => 'GET',
        'callback'            => 'artasia_rest_get_documentation_process_gallery',
        'permission_callback' => '__return_true',
        'args'                => [
            'document_id' => [
                'required'          => true,
                'sanitize_callback' => 'absint',
                'validate_callback' => static function ($value): bool {
                    return intval($value) >= 0;
                },
            ],
            'placement_id' => [
                'required'          => false,
                'sanitize_callback' => 'absint',
            ],
            'preview' => [
                'required'          => false,
                'sanitize_callback' => 'absint',
                'validate_callback' => static function ($value): bool {
                    return in_array(intval($value), [0, 1], true);
                },
            ],
        ],
    ]);
}
add_action('rest_api_init', 'artasia_documentation_gallery_rest_routes');

function artasia_get_atlas_process_gallery(int $placement_id, bool $force_refresh = false): ?array
{
    $cache_key = 'artasia_process_gallery_' . $placement_id;
    if (!$force_refresh) {
        $cached = get_transient($cache_key);
        if (is_array($cached)) {
            return $cached;
        }
    }

    $endpoint = apply_filters(
        'artasia_process_gallery_url',
        artasia_atlas_base_url() . '/api/v1/placements/' . $placement_id . '/process-gallery',
        $placement_id
    );
    $response = wp_remote_get($endpoint, [
        'timeout'     => 5,
        'redirection' => 2,
        'headers'     => [
            'Accept' => 'application/json',
        ],
    ]);

    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return null;
    }

    $payload = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($payload) || !isset($payload['assets']) || !is_array($payload['assets'])) {
        return null;
    }

    $atlas_base = artasia_atlas_base_url();
    $assets = [];
    foreach ($payload['assets'] as $asset) {
        if (!is_array($asset) || empty($asset['id'])) {
            continue;
        }

        $assets[] = [
            'id'          => sanitize_text_field((string) $asset['id']),
            'mediaKind'   => sanitize_key((string) ($asset['mediaKind'] ?? 'image')),
            'thumbnailUrl' => artasia_absolute_atlas_media_url($asset['thumbnailUrl'] ?? '', $atlas_base),
            'previewUrl'  => artasia_absolute_atlas_media_url($asset['previewUrl'] ?? '', $atlas_base),
            'width'       => absint($asset['width'] ?? 0),
            'height'      => absint($asset['height'] ?? 0),
            'createdAt'   => sanitize_text_field((string) ($asset['createdAt'] ?? '')),
            'caption'     => sanitize_text_field((string) ($asset['caption'] ?? $asset['fileName'] ?? '')),
            'alt'         => sanitize_text_field((string) ($asset['alt'] ?? $asset['caption'] ?? $asset['fileName'] ?? 'Process image')),
        ];
    }

    $result = [
        'placementId' => $placement_id,
        'assets'      => $assets,
    ];
    set_transient($cache_key, $result, 5 * MINUTE_IN_SECONDS);

    return $result;
}

function artasia_absolute_atlas_media_url($url, string $atlas_base): string
{
    $url = trim((string) $url);
    if ($url === '') {
        return '';
    }

    return strpos($url, 'http://') === 0 || strpos($url, 'https://') === 0
        ? esc_url_raw($url)
        : esc_url_raw($atlas_base . '/' . ltrim($url, '/'));
}

function artasia_rest_get_documentation_process_gallery(WP_REST_Request $request)
{
    $document_id = intval($request->get_param('document_id'));
    $document = get_post($document_id);
    $is_preview = intval($request->get_param('preview')) === 1;
    $can_preview = $is_preview
        && current_user_can('edit_posts')
        && (!$document_id || current_user_can('edit_post', $document_id));

    if ($document_id && (!$document instanceof WP_Post || $document->post_type !== 'artasia_document')) {
        return new WP_Error('artasia_documentation_not_found', 'Documentation not found.', ['status' => 404]);
    }

    if (!$can_preview && (!$document instanceof WP_Post || $document->post_status !== 'publish')) {
        return new WP_Error('artasia_documentation_not_found', 'Documentation not found.', ['status' => 404]);
    }

    $placement_id = $can_preview ? absint($request->get_param('placement_id')) : 0;
    if (!$placement_id && $document_id) {
        $placement_ids = artasia_validate_related_post_ids(
            get_post_meta($document_id, 'artasia_documentation_placement_ids', true),
            'artasia_placement'
        );
        $placement_id = intval($placement_ids[0] ?? 0);
    }
    if (!$placement_id) {
        return new WP_Error('artasia_placement_not_found', 'Documentation has no placement.', ['status' => 404]);
    }

    if ($can_preview && get_post_type($placement_id) !== 'artasia_placement') {
        return new WP_Error('artasia_placement_not_found', 'Placement not found.', ['status' => 404]);
    }

    $gallery = artasia_get_atlas_process_gallery($placement_id, $is_preview);
    if (!is_array($gallery)) {
        return new WP_Error('artasia_atlas_gallery_unavailable', 'Atlas gallery is unavailable.', ['status' => 502]);
    }

    return rest_ensure_response($gallery);
}
