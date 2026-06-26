jQuery(function ($) {
  if (!window.wp || !wp.media) {
    return;
  }

  function setupImagePicker(options) {
    var $attachmentId = $(options.inputSelector);

    if (!$attachmentId.length) {
      return;
    }

    var frame;
    var $preview = $(options.previewSelector);
    var $removeButton = $(options.removeSelector);

    function setImage(attachment) {
      $attachmentId.val(attachment.id);
      $preview.html($('<img>', {
        src: attachment.url,
        alt: ''
      }));
      $removeButton.prop('disabled', false);
    }

    $(options.selectSelector).on('click', function (event) {
      event.preventDefault();

      if (frame) {
        frame.open();
        return;
      }

      frame = wp.media({
        title: options.title,
        button: {
          text: options.buttonText
        },
        library: {
          type: 'image'
        },
        multiple: false
      });

      frame.on('select', function () {
        var attachment = frame.state().get('selection').first().toJSON();

        if (options.allowedMimeTypes && options.allowedMimeTypes.indexOf(attachment.mime) === -1) {
          window.alert(options.invalidMessage);
          return;
        }

        setImage(attachment);
      });

      frame.open();
    });

    $removeButton.on('click', function (event) {
      event.preventDefault();

      $attachmentId.val('0');
      $preview.empty();
      $removeButton.prop('disabled', true);
    });
  }

  setupImagePicker({
    inputSelector: '#artasia_partner_logo_id',
    previewSelector: '#artasia_partner_logo_preview',
    selectSelector: '#artasia_partner_logo_select',
    removeSelector: '#artasia_partner_logo_remove',
    title: 'Select Artasia Partner Logo',
    buttonText: 'Use this logo',
    allowedMimeTypes: ['image/png', 'image/svg+xml'],
    invalidMessage: 'Please choose a PNG or SVG logo.'
  });

  setupImagePicker({
    inputSelector: '#artasia_people_photo_id',
    previewSelector: '#artasia_people_photo_preview',
    selectSelector: '#artasia_people_photo_select',
    removeSelector: '#artasia_people_photo_remove',
    title: 'Select Artasia Person Photo',
    buttonText: 'Use this photo',
    invalidMessage: 'Please choose an image file.',
    allowedMimeTypes: null
  });
});
