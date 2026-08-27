<?php

if (!defined('ABSPATH')) {
    exit;
}

class Artasia_Logos_Elementor_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string
    {
        return 'artasia_logos';
    }

    public function get_title(): string
    {
        return 'Artasia Logo Grid';
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
        return ['artasia', 'logos', 'partners', 'supporters', 'sponsors'];
    }

    public function get_style_depends(): array
    {
        return ['artasia-logos-shortcode'];
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

        $project_options = [];
        foreach ($projects as $project) {
            $year = intval(get_post_meta($project->ID, 'artasia_project_year', true));
            $project_options[(string) $project->ID] = ($year ? $year . ' - ' : '') . $project->post_title;
        }
        $project_option_ids = array_keys($project_options);

        $this->start_controls_section('artasia_logos_content', [
            'label' => 'Logo Grid',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('project_id', [
            'label'       => 'Artasia Project',
            'type'        => \Elementor\Controls_Manager::SELECT,
            'options'     => $project_options,
            'default'     => $project_option_ids[0] ?? '',
            'label_block' => true,
            'description' => 'Choose the annual Artasia project whose supporters should appear.',
        ]);

        $this->add_control('partner_heading', [
            'label'       => 'Partners heading',
            'type'        => \Elementor\Controls_Manager::TEXT,
            'default'     => 'Partners',
            'label_block' => true,
        ]);

        $this->add_control('partner_intro', [
            'label'       => 'Partners intro text',
            'type'        => \Elementor\Controls_Manager::TEXTAREA,
            'default'     => 'Arts For All recognizes the invaluable work of our community partners. Artasia would not exist without you. Thank you!',
            'rows'        => 3,
            'label_block' => true,
        ]);

        $this->add_control('supporter_heading', [
            'label'       => 'Supporters heading',
            'type'        => \Elementor\Controls_Manager::TEXT,
            'default'     => 'Supporters',
            'label_block' => true,
        ]);

        $this->add_control('supporter_intro', [
            'label'       => 'Supporters intro text',
            'type'        => \Elementor\Controls_Manager::TEXTAREA,
            'default'     => 'Arts For All is grateful to our sponsors and supporters at all levels. Thank you!',
            'rows'        => 3,
            'label_block' => true,
        ]);

        $this->add_control('logo_variant', [
            'label'   => 'Logo variation',
            'type'    => \Elementor\Controls_Manager::SELECT,
            'options' => [
                'colour' => 'Colour',
                'white'  => 'White',
            ],
            'default' => 'colour',
        ]);

        $this->add_control('logos_instructions', [
            'type' => \Elementor\Controls_Manager::RAW_HTML,
            'raw'  => sprintf(
                '<p>Manage logos and website links in <a href="%s" target="_blank" rel="noopener noreferrer">Artasia Partners</a> and <a href="%s" target="_blank" rel="noopener noreferrer">Artasia Supporters</a>. Manage this project’s supporter selection and display order from the Project edit screen. Supporters are grouped automatically by their saved type.</p><p>Shortcode equivalent: <code>[artasia_logos project_id="123"]</code></p>',
                esc_url(admin_url('edit.php?post_type=artasia_partner')),
                esc_url(admin_url('edit.php?post_type=artasia_supporter'))
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
                echo '<p>Select an Artasia project to display its partner and supporter logos.</p>';
            }
            return;
        }

        $output = artasia_render_logos([
            'partner_heading'   => (string) ($settings['partner_heading'] ?? 'Partners'),
            'partner_intro'     => (string) ($settings['partner_intro'] ?? 'Arts For All recognizes the invaluable work of our community partners. Artasia would not exist without you. Thank you!'),
            'supporter_heading' => (string) ($settings['supporter_heading'] ?? 'Supporters'),
            'supporter_intro'   => (string) ($settings['supporter_intro'] ?? 'Arts For All is grateful to our sponsors and supporters at all levels. Thank you!'),
            'variant'           => (string) ($settings['logo_variant'] ?? 'colour'),
            'project_id'        => $project_id,
        ]);

        if ($output === '' && \Elementor\Plugin::$instance->editor->is_edit_mode()) {
            echo '<p>No published partners or supporters with logos were found for this project.</p>';
            return;
        }

        echo $output;
    }
}
