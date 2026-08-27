<?php

if (!defined('ABSPATH')) {
    exit;
}

class Artasia_Sites_Elementor_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string
    {
        return 'artasia_sites';
    }

    public function get_title(): string
    {
        return 'Artasia Sites';
    }

    public function get_icon(): string
    {
        return 'eicon-map-pin';
    }

    public function get_categories(): array
    {
        return ['general'];
    }

    public function get_keywords(): array
    {
        return ['artasia', 'sites', 'placements', 'partners', 'project'];
    }

    public function get_style_depends(): array
    {
        return ['artasia-sites-shortcode'];
    }

    protected function register_controls(): void
    {
        $projects = get_posts([
            'post_type'      => 'artasia_project',
            'posts_per_page' => -1,
            'post_status'    => 'publish',
            'meta_key'       => 'artasia_project_year',
            'orderby'        => [
                'meta_value_num' => 'DESC',
                'title'          => 'ASC',
            ],
            'no_found_rows'  => true,
        ]);

        $options = [];
        foreach ($projects as $project) {
            $year = intval(get_post_meta($project->ID, 'artasia_project_year', true));
            $options[(string) $project->ID] = ($year ? $year . ' - ' : '') . $project->post_title;
        }

        $option_ids = array_keys($options);

        $this->start_controls_section('artasia_sites_content', [
            'label' => 'Sites',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('project_id', [
            'label'       => 'Artasia Project',
            'type'        => \Elementor\Controls_Manager::SELECT,
            'options'     => $options,
            'default'     => $option_ids[0] ?? '',
            'label_block' => true,
            'description' => 'Choose the annual Artasia project whose placement sites should appear.',
        ]);

        $this->add_control('sites_instructions', [
            'type' => \Elementor\Controls_Manager::RAW_HTML,
            'raw'  => sprintf(
                '<p>Manage site assignments in <a href="%s" target="_blank" rel="noopener noreferrer">Artasia Placements</a>. Each placement must be connected to the selected project and a partner, and its <strong>Publish this placement in Artasia site listings</strong> checkbox must be active. The selected Project controls whether Gallery and Documentation links use dynamic availability lookup.</p>',
                esc_url(admin_url('edit.php?post_type=artasia_placement'))
            ),
            'content_classes' => 'elementor-panel-alert elementor-panel-alert-info',
        ]);

        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $project_id = intval($settings['project_id'] ?? 0);

        if (!$project_id) {
            if (\Elementor\Plugin::$instance->editor->is_edit_mode()) {
                echo '<p>Select an Artasia project to display its sites.</p>';
            }

            return;
        }

        $output = artasia_render_sites($project_id);
        if ($output === '' && \Elementor\Plugin::$instance->editor->is_edit_mode()) {
            echo '<p>No published placement sites are associated with this project.</p>';
            return;
        }

        echo $output;
    }
}
