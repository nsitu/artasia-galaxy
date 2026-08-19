(function () {
  function createAtlasGalleryMarkup(gallery, assets) {
    if (!assets.length) {
      gallery.remove();
      return false;
    }

    var grid = document.createElement('div');
    grid.className = 'artasia-documentation-gallery__grid';

    assets.forEach(function (asset, index) {
      var thumbnailUrl = asset.thumbnailUrl || asset.previewUrl;
      var previewUrl = asset.previewUrl || thumbnailUrl;
      if (!thumbnailUrl || !previewUrl) {
        return;
      }

      var figure = document.createElement('figure');
      figure.className = 'artasia-documentation-gallery__item';

      var trigger = document.createElement('a');
      trigger.className = 'artasia-documentation-gallery__trigger';
      trigger.href = previewUrl;
      trigger.dataset.galleryIndex = String(index);
      trigger.setAttribute('aria-label', 'Open image ' + (index + 1) + ' of ' + assets.length);

      var image = document.createElement('img');
      image.className = 'artasia-documentation-gallery__thumbnail';
      image.src = thumbnailUrl;
      image.alt = asset.alt || asset.caption || 'Process image';
      image.loading = 'lazy';
      trigger.appendChild(image);
      figure.appendChild(trigger);

      var captionText = String(asset.caption || '').trim();
      if (captionText) {
        var caption = document.createElement('figcaption');
        caption.className = 'artasia-documentation-gallery__caption';
        caption.textContent = captionText;
        figure.appendChild(caption);
      }

      grid.appendChild(figure);
    });

    if (!grid.children.length) {
      gallery.remove();
      return false;
    }

    gallery.replaceChildren(grid);
    var dialog = document.createElement('dialog');
    dialog.className = 'artasia-documentation-lightbox';
    dialog.setAttribute('aria-label', 'Image viewer');
    dialog.innerHTML = [
      '<button type="button" class="artasia-documentation-lightbox__close" aria-label="Close image viewer">&times;</button>',
      '<button type="button" class="artasia-documentation-lightbox__previous" aria-label="Previous image">&lsaquo;</button>',
      '<div class="artasia-documentation-lightbox__content">',
      '<img class="artasia-documentation-lightbox__image" alt="">',
      '<p class="artasia-documentation-lightbox__caption" hidden></p>',
      '</div>',
      '<button type="button" class="artasia-documentation-lightbox__next" aria-label="Next image">&rsaquo;</button>'
    ].join('');
    gallery.appendChild(dialog);
    return true;
  }

  function initializeAtlasGallery(gallery) {
    if (gallery.dataset.artasiaAtlasGalleryInitialized === 'true') {
      return;
    }

    var endpoint = gallery.dataset.atlasEndpoint;
    if (!endpoint || !window.fetch) {
      gallery.remove();
      return;
    }

    gallery.dataset.artasiaAtlasGalleryInitialized = 'true';
    fetch(endpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to load process gallery.');
        }
        return response.json();
      })
      .then(function (result) {
        var assets = Array.isArray(result.assets) ? result.assets : [];
        if (createAtlasGalleryMarkup(gallery, assets)) {
          initializeGallery(gallery);
        }
      })
      .catch(function () {
        gallery.remove();
      });
  }

  function initializeGallery(gallery) {
    if (gallery.dataset.artasiaLightboxInitialized === 'true') {
      return;
    }

    var triggers = Array.prototype.slice.call(
      gallery.querySelectorAll('.artasia-documentation-gallery__trigger')
    );
    var dialog = gallery.querySelector('.artasia-documentation-lightbox');

    if (!triggers.length || !dialog || typeof dialog.showModal !== 'function') {
      return;
    }

    gallery.dataset.artasiaLightboxInitialized = 'true';

    var image = dialog.querySelector('.artasia-documentation-lightbox__image');
    var caption = dialog.querySelector('.artasia-documentation-lightbox__caption');
    var previous = dialog.querySelector('.artasia-documentation-lightbox__previous');
    var next = dialog.querySelector('.artasia-documentation-lightbox__next');
    var close = dialog.querySelector('.artasia-documentation-lightbox__close');
    var currentIndex = 0;
    var opener = null;

    function showImage(index) {
      currentIndex = (index + triggers.length) % triggers.length;

      var trigger = triggers[currentIndex];
      var thumbnail = trigger.querySelector('img');
      var figureCaption = trigger.closest('figure').querySelector('figcaption');
      var captionText = figureCaption ? figureCaption.textContent.trim() : '';

      image.src = trigger.href;
      image.alt = thumbnail ? thumbnail.alt : '';
      caption.textContent = captionText;
      caption.hidden = !captionText;
      previous.disabled = triggers.length < 2;
      next.disabled = triggers.length < 2;
    }

    triggers.forEach(function (trigger, index) {
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        opener = trigger;
        showImage(index);
        dialog.showModal();
      });
    });

    previous.addEventListener('click', function () {
      showImage(currentIndex - 1);
    });

    next.addEventListener('click', function () {
      showImage(currentIndex + 1);
    });

    close.addEventListener('click', function () {
      dialog.close();
    });

    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showImage(currentIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showImage(currentIndex + 1);
      }
    });

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    dialog.addEventListener('close', function () {
      image.removeAttribute('src');
      if (opener) {
        opener.focus();
      }
    });
  }

  window.artasiaInitDocumentationGalleries = function (root) {
    var scope = root || document;
    scope.querySelectorAll('.artasia-documentation-gallery--atlas').forEach(initializeAtlasGallery);
    scope.querySelectorAll('.artasia-documentation-gallery').forEach(initializeGallery);
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.artasiaInitDocumentationGalleries(document);
  });
})();
