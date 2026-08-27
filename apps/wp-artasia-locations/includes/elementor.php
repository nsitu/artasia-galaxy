<?php

if (!defined('ABSPATH')) {
    exit;
}

function artasia_register_elementor_widgets($widgets_manager): void
{
    if (!class_exists('\Elementor\Widget_Base')) {
        return;
    }

    require_once ARTASIA_LOCATIONS_PATH . 'includes/widgets/class-artasia-team-widget.php';
    require_once ARTASIA_LOCATIONS_PATH . 'includes/widgets/class-artasia-sites-widget.php';
    require_once ARTASIA_LOCATIONS_PATH . 'includes/widgets/class-artasia-logos-widget.php';
    require_once ARTASIA_LOCATIONS_PATH . 'includes/widgets/class-artasia-documentation-widget.php';
    require_once ARTASIA_LOCATIONS_PATH . 'includes/widgets/class-artasia-exhibition-widget.php';
    $widgets_manager->register(new Artasia_Team_Elementor_Widget());
    $widgets_manager->register(new Artasia_Sites_Elementor_Widget());
    $widgets_manager->register(new Artasia_Logos_Elementor_Widget());
    $widgets_manager->register(new Artasia_Documentation_Elementor_Widget());
    $widgets_manager->register(new Artasia_Exhibition_Elementor_Widget());
}
add_action('elementor/widgets/register', 'artasia_register_elementor_widgets');
