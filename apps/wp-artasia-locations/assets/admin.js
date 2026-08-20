jQuery(function ($) {
  function normalizeGoogleDriveFolderId(value) {
    var rawValue = String(value || '').trim();
    var urlMatch = rawValue.match(/\/folders\/([A-Za-z0-9_-]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    return /^[A-Za-z0-9_-]+$/.test(rawValue) ? rawValue : '';
  }

  function setupGoogleDriveFolderLink() {
    var $input = $('#artasia_google_drive_folder_id');
    var $link = $('#artasia_google_drive_folder_link');

    if (!$input.length || !$link.length) {
      return;
    }

    function updateLink() {
      var folderId = normalizeGoogleDriveFolderId($input.val());
      $link.attr(
        'href',
        folderId
          ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId)
          : 'https://drive.google.com/'
      );
      $link.text(folderId ? 'Open in Google Drive' : 'Open Google Drive');
    }

    $input.on('input change', updateLink);
    updateLink();
  }

  setupGoogleDriveFolderLink();

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

  var hasWordPressMedia = window.wp && window.wp.media;

  if (hasWordPressMedia) {
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
      inputSelector: '#artasia_partner_white_logo_id',
      previewSelector: '#artasia_partner_white_logo_preview',
      selectSelector: '#artasia_partner_white_logo_select',
      removeSelector: '#artasia_partner_white_logo_remove',
      title: 'Select Artasia Partner White Logo',
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
  }

  function setupDocumentationGallery() {
    var $items = $('#artasia_documentation_gallery_items');

    if (!$items.length) {
      return;
    }

    var frame;
    var $clearButton = $('#artasia_documentation_gallery_clear');

    function updateClearButton() {
      $clearButton.prop('disabled', !$items.children().length);
    }

    function addImage(attachment) {
      if ($items.children('[data-attachment-id="' + attachment.id + '"]').length) {
        return;
      }

      var thumbnailUrl = attachment.url;
      if (attachment.sizes && attachment.sizes.medium) {
        thumbnailUrl = attachment.sizes.medium.url;
      } else if (attachment.sizes && attachment.sizes.thumbnail) {
        thumbnailUrl = attachment.sizes.thumbnail.url;
      }

      var caption = attachment.caption || attachment.title || '';
      var $item = $('<li>', {
        class: 'artasia-documentation-gallery-item',
        'data-attachment-id': attachment.id
      });

      $item.append($('<span>', {
        class: 'artasia-documentation-gallery-handle dashicons dashicons-move',
        'aria-label': 'Drag to reorder',
        title: 'Drag to reorder'
      }));
      $item.append($('<img>', {
        class: 'artasia-documentation-gallery-thumbnail',
        src: thumbnailUrl,
        alt: ''
      }));
      $item.append($('<label>', {
        class: 'screen-reader-text',
        for: 'artasia-documentation-caption-' + attachment.id,
        text: 'Image caption'
      }));
      $item.append($('<textarea>', {
        id: 'artasia-documentation-caption-' + attachment.id,
        class: 'artasia-documentation-gallery-caption',
        name: 'artasia_documentation_gallery_captions[]',
        rows: 4,
        placeholder: 'Add a caption',
        val: caption
      }));
      $item.append($('<input>', {
        type: 'hidden',
        name: 'artasia_documentation_gallery_ids[]',
        value: attachment.id
      }));
      $item.append($('<button>', {
        type: 'button',
        class: 'button-link-delete artasia-documentation-gallery-remove',
        text: 'Remove'
      }));

      $items.append($item);
    }

    $items.sortable({
      handle: '.artasia-documentation-gallery-handle',
      placeholder: 'artasia-documentation-gallery-placeholder',
      forcePlaceholderSize: true
    });

    $('#artasia_documentation_gallery_select').on('click', function (event) {
      event.preventDefault();

      if (frame) {
        frame.open();
        return;
      }

      frame = wp.media({
        title: 'Select Documentation Gallery Images',
        button: {
          text: 'Add to gallery'
        },
        library: {
          type: 'image'
        },
        multiple: 'add'
      });

      frame.on('select', function () {
        frame.state().get('selection').each(function (model) {
          addImage(model.toJSON());
        });
        updateClearButton();
      });

      frame.open();
    });

    $items.on('click', '.artasia-documentation-gallery-remove', function (event) {
      event.preventDefault();
      $(this).closest('.artasia-documentation-gallery-item').remove();
      updateClearButton();
    });

    $clearButton.on('click', function (event) {
      event.preventDefault();
      $items.empty();
      updateClearButton();
    });
  }

  function setupDocumentationGallerySource() {
    var $source = $('#artasia_documentation_gallery_source');
    var $panels = $('[data-artasia-gallery-source-panel]');

    if (!$source.length || !$panels.length) {
      return;
    }

    function updatePanels() {
      var source = $source.val() === 'atlas' ? 'atlas' : 'wordpress';

      $panels.each(function () {
        var isActive = $(this).attr('data-artasia-gallery-source-panel') === source;
        $(this).prop('hidden', !isActive).attr('aria-hidden', isActive ? 'false' : 'true');
      });
    }

    $source.on('change', updatePanels);
    updatePanels();
  }

  function setupDocumentationAtlasPreview() {
    var $source = $('#artasia_documentation_gallery_source');
    var $placement = $('#artasia_documentation_placement_ids');
    var $preview = $('[data-artasia-atlas-preview]');

    if (!$source.length || !$placement.length || !$preview.length || !window.fetch) {
      return;
    }

    var endpoint = $preview.attr('data-artasia-atlas-preview-endpoint');
    var nonce = $preview.attr('data-artasia-atlas-preview-nonce');
    var $status = $preview.find('[data-artasia-atlas-preview-status]');
    var $items = $preview.find('[data-artasia-atlas-preview-items]');
    var $refresh = $preview.find('[data-artasia-atlas-preview-refresh]');
    var requestNumber = 0;

    function setStatus(message) {
      $status.text(message);
    }

    function renderAssets(assets) {
      $items.empty();

      assets.forEach(function (asset) {
        var thumbnailUrl = asset.thumbnailUrl || asset.previewUrl;
        if (!thumbnailUrl) {
          return;
        }

        var caption = String(asset.caption || '').trim();
        var $item = $('<li>', { class: 'artasia-documentation-atlas-preview-item' });
        var $link = $('<a>', {
          class: 'artasia-documentation-atlas-preview-link',
          href: asset.previewUrl || thumbnailUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': 'Open process asset in a new tab'
        });
        $link.append($('<img>', {
          class: 'artasia-documentation-atlas-preview-thumbnail',
          src: thumbnailUrl,
          alt: asset.alt || caption || 'Process image',
          loading: 'lazy'
        }));
        $item.append($link);
        if (caption) {
          $item.append($('<p>', {
            class: 'artasia-documentation-atlas-preview-caption',
            text: caption
          }));
        }
        $items.append($item);
      });

      return $items.children().length;
    }

    function loadPreview() {
      var currentRequest = ++requestNumber;
      $refresh.prop('disabled', false);

      if ($source.val() !== 'atlas') {
        return;
      }

      var placementId = String($placement.val() || '').trim();
      $items.empty();

      if (!placementId) {
        setStatus('Select a placement to preview its published Atlas process images.');
        return;
      }

      if (!endpoint) {
        setStatus('Save this documentation before previewing its Atlas process images.');
        return;
      }

      var separator = endpoint.indexOf('?') === -1 ? '?' : '&';
      var previewUrl = endpoint + separator + 'preview=1&placement_id=' + encodeURIComponent(placementId);
      setStatus('Loading Atlas process images…');
      $refresh.prop('disabled', true);

      fetch(previewUrl, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-WP-Nonce': nonce || ''
        }
      })
        .then(function (response) {
          return response.json().catch(function () {
            return {};
          }).then(function (result) {
            if (!response.ok) {
              throw new Error(result.message || result.error || 'Unable to load process gallery.');
            }
            return result;
          });
        })
        .then(function (result) {
          if (currentRequest !== requestNumber || $source.val() !== 'atlas') {
            return;
          }

          var count = renderAssets(Array.isArray(result.assets) ? result.assets : []);
          setStatus(count ? count + ' published process image' + (count === 1 ? '' : 's') + ' available from Atlas.' : 'No published Atlas process images are currently available for this placement.');
        })
        .catch(function (error) {
          if (currentRequest === requestNumber) {
            setStatus(error && error.message ? error.message : 'Atlas process images could not be loaded.');
          }
        })
        .then(function () {
          if (currentRequest === requestNumber) {
            $refresh.prop('disabled', false);
          }
        });
    }

    $source.on('change', loadPreview);
    $placement.on('change', loadPreview);
    $refresh.on('click', function (event) {
      event.preventDefault();
      loadPreview();
    });
    loadPreview();
  }

  setupDocumentationGallerySource();
  setupDocumentationAtlasPreview();
  if (hasWordPressMedia) {
    setupDocumentationGallery();
  }
});
