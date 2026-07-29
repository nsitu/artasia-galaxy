<?php

if (!defined('ABSPATH')) {
    exit;
}

class Artasia_Team_Elementor_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string
    {
        return 'artasia_team';
    }

    public function get_title(): string
    {
        return 'Artasia Team';
    }

    public function get_icon(): string
    {
        return 'eicon-person';
    }

    public function get_categories(): array
    {
        return ['general'];
    }

    public function get_keywords(): array
    {
        return ['artasia', 'team', 'people', 'project'];
    }

    public function get_style_depends(): array
    {
        return ['artasia-team-shortcode'];
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

        $this->start_controls_section('artasia_team_content', [
            'label' => 'Team',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('project_id', [
            'label'       => 'Artasia Project',
            'type'        => \Elementor\Controls_Manager::SELECT,
            'options'     => $options,
            'default'     => $option_ids[0] ?? '',
            'label_block' => true,
            'description' => 'Choose the annual Artasia project whose team should appear.',
        ]);

        $people_admin_url = admin_url('edit.php?post_type=artasia_people');
        $this->add_control('team_instructions', [
            'type' => \Elementor\Controls_Manager::RAW_HTML,
            'raw'  => sprintf(
                '<p>Manage team profiles in <a href="%s" target="_blank" rel="noopener noreferrer">Artasia People</a>.</p><p><strong>Important:</strong> People will not appear in this team listing unless the <strong>Publish this person in Artasia team listings</strong> checkbox is active on their profile.</p>',
                esc_url($people_admin_url)
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
                echo '<p>Select an Artasia project to display its team.</p>';
            }

            return;
        }

        $output = artasia_render_team($project_id);
        if ($output === '' && \Elementor\Plugin::$instance->editor->is_edit_mode()) {
            echo '<p>No published team profiles are associated with this project.</p>';
            return;
        }

        echo $output;
    }
}
