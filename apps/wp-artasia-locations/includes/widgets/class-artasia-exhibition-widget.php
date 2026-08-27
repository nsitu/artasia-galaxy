<?php

if (!defined('ABSPATH')) {
    exit;
}

class Artasia_Exhibition_Elementor_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string
    {
        return 'artasia_exhibition';
    }

    public function get_title(): string
    {
        return 'Artasia Exhibition';
    }

    public function get_icon(): string
    {
        return 'eicon-gallery-grid';
    }

    public function get_categories(): array
    {
        return ['general'];
    }

    public function get_keywords(): array
    {
        return ['artasia', 'exhibition', 'show', 'gallery', 'venue'];
    }

    public function get_style_depends(): array
    {
        return ['artasia-exhibition-shortcode'];
    }

    protected function register_controls(): void
    {
        $exhibitions = get_posts([
            'post_type'      => 'artasia_exhibition',
            'posts_per_page' => -1,
            'post_status'    => 'publish',
            'orderby'        => 'title',
            'order'          => 'ASC',
            'no_found_rows'  => true,
        ]);

        $options = [
            '0' => 'Select an exhibition',
        ];
        foreach ($exhibitions as $exhibition) {
            $host_name = trim((string) get_post_meta($exhibition->ID, 'artasia_exhibition_host_name', true));
            $options[(string) $exhibition->ID] = $exhibition->post_title
                . ($host_name !== '' ? ' — ' . $host_name : '');
        }

        $this->start_controls_section('artasia_exhibition_content', [
            'label' => 'Exhibition',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('exhibition_id', [
            'label'       => 'Artasia Exhibition',
            'type'        => \Elementor\Controls_Manager::SELECT,
            'options'     => $options,
            'default'     => '0',
            'label_block' => true,
            'description' => 'Choose the published exhibition to display.',
        ]);

        $this->add_control('exhibition_instructions', [
            'type' => \Elementor\Controls_Manager::RAW_HTML,
            'raw'  => sprintf(
                '<p>Manage exhibition titles, descriptions, dates, host details, and logos in <a href="%s" target="_blank" rel="noopener noreferrer">Artasia Exhibitions</a>.</p><p>Shortcode equivalent: <code>[artasia_exhibition id="123"]</code></p>',
                esc_url(admin_url('edit.php?post_type=artasia_exhibition'))
            ),
            'content_classes' => 'elementor-panel-alert elementor-panel-alert-info',
        ]);

        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $exhibition_id = absint($settings['exhibition_id'] ?? 0);

        if (!$exhibition_id) {
            if (\Elementor\Plugin::$instance->editor->is_edit_mode()) {
                echo '<p>Select an Artasia exhibition to display.</p>';
            }

            return;
        }

        $output = artasia_render_exhibition($exhibition_id);
        if ($output === '' && \Elementor\Plugin::$instance->editor->is_edit_mode()) {
            echo '<p>The selected exhibition is not published or could not be found.</p>';
            return;
        }

        echo $output;
    }
}
