(function (wp) {
  if (!wp || !wp.plugins || !wp.editPost || !wp.element) {
    return;
  }

  var createElement = wp.element.createElement;
  var PluginDocumentSettingPanel = wp.editPost.PluginDocumentSettingPanel;

  wp.plugins.registerPlugin('artasia-site-info-panel', {
    render: function () {
      return createElement(
        PluginDocumentSettingPanel,
        {
          name: 'artasia-site-info',
          title: 'About Artasia Sites',
          className: 'artasia-site-info-panel'
        },
        createElement(
          'p',
          {},
          "An Artasia Site represents one year's activation of a particular venue by a particular Artasia Partner."
        ),
        createElement(
          'p',
          {},
          'Use this post to connect the venue, Artasia Partner, program context, section, and participant details for that activation.'
        )
      );
    }
  });
})(window.wp);
