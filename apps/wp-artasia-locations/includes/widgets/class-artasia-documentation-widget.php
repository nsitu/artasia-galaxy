<?php

if (!defined('ABSPATH')) {
    exit;
}

class Artasia_Documentation_Elementor_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string
    {
        return 'artasia_documentation';
    }

    public function get_title(): string
    {
        return 'Artasia Documentation';
    }

    public function get_icon(): string
    {
        return 'eicon-document-file';
    }

    public function get_categories(): array
    {
        return ['general'];
    }

    public function get_keywords(): array
    {
        return ['artasia', 'documentation', 'gallery', 'partners', 'project'];
    }

    public function get_style_depends(): array
    {
        return ['artasia-documentation-gallery', 'artasia-documentation-shortcode'];
    }

    public function get_script_depends(): array
    {
        return ['artasia-documentation-gallery', 'artasia-documentation-shortcode'];
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

        $this->start_controls_section('artasia_documentation_content', [
            'label' => 'Documentation',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('project_id', [
            'label'       => 'Artasia Project',
            'type'        => \Elementor\Controls_Manager::SELECT,
            'options'     => $options,
            'default'     => $option_ids[0] ?? '',
            'label_block' => true,
            'description' => 'Choose the annual project whose documentation should be available in the navigation.',
        ]);

        $this->add_control('documentation_instructions', [
            'type' => \Elementor\Controls_Manager::RAW_HTML,
            'raw'  => sprintf(
                '<p>Manage entries in <a href="%s" target="_blank" rel="noopener noreferrer">Pedagogical Documentation</a>. Only published entries connected to a placement in the selected project will appear.</p>',
                esc_url(admin_url('edit.php?post_type=artasia_document'))
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
                echo '<p>Select an Artasia project to display its documentation.</p>';
            }
            return;
        }

        $output = artasia_render_documentation_viewer($project_id);
        if ($output === '' && \Elementor\Plugin::$instance->editor->is_edit_mode()) {
            echo '<p>No published documentation is associated with this project.</p>';
            return;
        }

        echo $output;
    }
}
