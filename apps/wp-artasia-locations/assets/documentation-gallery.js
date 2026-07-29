document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.artasia-documentation-gallery').forEach(function (gallery) {
    var triggers = Array.prototype.slice.call(
      gallery.querySelectorAll('.artasia-documentation-gallery__trigger')
    );
    var dialog = gallery.querySelector('.artasia-documentation-lightbox');

    if (!triggers.length || !dialog || typeof dialog.showModal !== 'function') {
      return;
    }

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
  });
});
