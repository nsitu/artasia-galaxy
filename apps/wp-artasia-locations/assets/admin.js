jQuery(function ($) {
  var $logoId = $('#artasia_partner_logo_id');

  if (!$logoId.length || !window.wp || !wp.media) {
    return;
  }

  var allowedMimeTypes = ['image/png', 'image/svg+xml'];
  var frame;
  var $preview = $('#artasia_partner_logo_preview');
  var $removeButton = $('#artasia_partner_logo_remove');

  function setLogo(attachment) {
    $logoId.val(attachment.id);
    $preview.html($('<img>', {
      src: attachment.url,
      alt: ''
    }));
    $removeButton.prop('disabled', false);
  }

  $('#artasia_partner_logo_select').on('click', function (event) {
    event.preventDefault();

    if (frame) {
      frame.open();
      return;
    }

    frame = wp.media({
      title: 'Select Artasia Partner Logo',
      button: {
        text: 'Use this logo'
      },
      library: {
        type: 'image'
      },
      multiple: false
    });

    frame.on('select', function () {
      var attachment = frame.state().get('selection').first().toJSON();

      if (allowedMimeTypes.indexOf(attachment.mime) === -1) {
        window.alert('Please choose a PNG or SVG logo.');
        return;
      }

      setLogo(attachment);
    });

    frame.open();
  });

  $removeButton.on('click', function (event) {
    event.preventDefault();

    $logoId.val('0');
    $preview.empty();
    $removeButton.prop('disabled', true);
  });
});
