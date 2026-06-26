jQuery(function ($) {
  function addSiteNotice() {
    if (!window.artasiaLocationsAdmin || !window.artasiaLocationsAdmin.siteNotice) {
      return true;
    }

    if (document.getElementById('artasia-site-editor-notice')) {
      return true;
    }

    var target = document.querySelector('.edit-post-layout__content') ||
      document.querySelector('.interface-interface-skeleton__content') ||
      document.querySelector('#wpbody-content');

    if (!target) {
      return false;
    }

    var notice = document.createElement('div');
    notice.id = 'artasia-site-editor-notice';
    notice.className = 'notice notice-info artasia-site-editor-notice';

    var title = document.createElement('p');
    var strong = document.createElement('strong');
    strong.textContent = window.artasiaLocationsAdmin.siteNotice.title;
    title.appendChild(strong);

    var body = document.createElement('p');
    body.textContent = window.artasiaLocationsAdmin.siteNotice.body;

    notice.appendChild(title);
    notice.appendChild(body);
    target.insertBefore(notice, target.firstChild);

    return true;
  }

  if (!addSiteNotice()) {
    var noticeAttempts = 0;
    var noticeTimer = window.setInterval(function () {
      noticeAttempts += 1;

      if (addSiteNotice() || noticeAttempts >= 20) {
        window.clearInterval(noticeTimer);
      }
    }, 250);
  }

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
