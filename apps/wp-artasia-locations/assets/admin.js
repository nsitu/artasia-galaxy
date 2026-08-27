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
      inputSelector: '#artasia_supporter_logo_id',
      previewSelector: '#artasia_supporter_logo_preview',
      selectSelector: '#artasia_supporter_logo_select',
      removeSelector: '#artasia_supporter_logo_remove',
      title: 'Select Artasia Supporter Logo',
      buttonText: 'Use this logo',
      allowedMimeTypes: ['image/png', 'image/svg+xml'],
      invalidMessage: 'Please choose a PNG or SVG logo.'
    });

    setupImagePicker({
      inputSelector: '#artasia_supporter_white_logo_id',
      previewSelector: '#artasia_supporter_white_logo_preview',
      selectSelector: '#artasia_supporter_white_logo_select',
      removeSelector: '#artasia_supporter_white_logo_remove',
      title: 'Select Artasia Supporter White Logo',
      buttonText: 'Use this logo',
      allowedMimeTypes: ['image/png', 'image/svg+xml'],
      invalidMessage: 'Please choose a PNG or SVG logo.'
    });

    setupImagePicker({
      inputSelector: '#artasia_exhibition_host_logo_id',
      previewSelector: '#artasia_exhibition_host_logo_preview',
      selectSelector: '#artasia_exhibition_host_logo_select',
      removeSelector: '#artasia_exhibition_host_logo_remove',
      title: 'Select Artasia Exhibition Host Logo',
      buttonText: 'Use this logo',
      allowedMimeTypes: ['image/png', 'image/svg+xml'],
      invalidMessage: 'Please choose a PNG or SVG logo.'
    });

    setupImagePicker({
      inputSelector: '#artasia_exhibition_host_white_logo_id',
      previewSelector: '#artasia_exhibition_host_white_logo_preview',
      selectSelector: '#artasia_exhibition_host_white_logo_select',
      removeSelector: '#artasia_exhibition_host_white_logo_remove',
      title: 'Select Artasia Exhibition Host White Logo',
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

  function setupProjectSupporterSorter() {
    var $lists = $('[data-artasia-project-supporters]');

    if (!$lists.length || !$.fn.sortable) {
      return;
    }

    $lists.each(function () {
      var $list = $(this);

      $list.sortable({
        axis: 'y',
        cursor: 'grabbing',
        handle: '.artasia-project-supporter-handle',
        items: '> .artasia-project-supporter-row',
        placeholder: 'artasia-project-supporter-row--placeholder',
        tolerance: 'pointer'
      });

      $list.on('change', 'input[type="checkbox"]', function () {
        $(this).closest('.artasia-project-supporter-row').toggleClass('is-assigned', this.checked);
      });
    });
  }

  setupProjectSupporterSorter();

  function setupDocumentationAtlasPreview() {
    var $placement = $('#artasia_documentation_placement_ids');
    var $preview = $('[data-artasia-atlas-preview]');

    if (!$placement.length || !$preview.length || !window.fetch) {
      return;
    }

    var endpoint = $preview.attr('data-artasia-atlas-preview-endpoint');
    var nonce = $preview.attr('data-artasia-atlas-preview-nonce');
    var $status = $preview.find('[data-artasia-atlas-preview-status]');
    var $items = $preview.find('[data-artasia-atlas-preview-items]');
    var $refresh = $preview.find('[data-artasia-atlas-preview-refresh]');
    var $atlasBrowseLink = $('[data-artasia-atlas-browse-link]');
    var atlasBrowseBaseUrl = $atlasBrowseLink.attr('data-artasia-atlas-browse-base-url');
    var requestNumber = 0;

    function updateAtlasBrowseLink() {
      if (!$atlasBrowseLink.length || !atlasBrowseBaseUrl) {
        return;
      }

      var placementId = String($placement.val() || '').trim();
      var browseUrl = atlasBrowseBaseUrl;
      if (placementId) {
        browseUrl += (browseUrl.indexOf('?') === -1 ? '?' : '&') + 'site=' + encodeURIComponent(placementId);
      }
      $atlasBrowseLink.attr('href', browseUrl);
    }

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
          if (currentRequest !== requestNumber) {
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

    $placement.on('change', function () {
      updateAtlasBrowseLink();
      loadPreview();
    });
    $refresh.on('click', function (event) {
      event.preventDefault();
      loadPreview();
    });
    updateAtlasBrowseLink();
    loadPreview();
  }

  setupDocumentationAtlasPreview();
});
