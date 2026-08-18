(function () {
  function initializeViewer(viewer) {
    if (viewer.dataset.artasiaDocumentationInitialized === 'true') {
      return;
    }
    viewer.dataset.artasiaDocumentationInitialized = 'true';

    var projectId = viewer.dataset.projectId;
    var restBase = viewer.dataset.restBase;
    var directory = viewer.querySelector('.artasia-documentation__directory');
    var detail = viewer.querySelector('.artasia-documentation__viewer');
    var content = viewer.querySelector('.artasia-documentation__content');
    var status = viewer.querySelector('.artasia-documentation__status');
    var related = viewer.querySelector('.artasia-documentation__related');
    var relatedList = related ? related.querySelector('ul') : null;
    var back = viewer.querySelector('[data-documentation-back]');
    var requestController = null;

    if (!projectId || !restBase || !directory || !detail || !content || !back || !window.fetch) {
      return;
    }

    function directoryLinks() {
      return Array.prototype.slice.call(
        directory.querySelectorAll('[data-documentation-slug]')
      );
    }

    function scrollToPageTop() {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'auto'
      });
    }

    function setCurrentLink(slug) {
      viewer.querySelectorAll('[data-documentation-slug]').forEach(function (link) {
        if (link.dataset.documentationSlug === slug) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    function updateRelated(slug) {
      if (!related || !relatedList) {
        return;
      }

      var current = directoryLinks().find(function (link) {
        return link.dataset.documentationSlug === slug;
      });
      relatedList.innerHTML = '';

      if (!current) {
        related.hidden = true;
        return;
      }

      directoryLinks().forEach(function (link) {
        if (
          link.dataset.partnerId !== current.dataset.partnerId
          || link.dataset.documentationSlug === slug
        ) {
          return;
        }

        var item = document.createElement('li');
        var suggestion = link.cloneNode(true);
        suggestion.removeAttribute('aria-current');
        item.appendChild(suggestion);
        relatedList.appendChild(item);
      });

      related.hidden = !relatedList.children.length;
    }

    function showDirectory(url, pushHistory) {
      if (requestController) {
        requestController.abort();
        requestController = null;
      }

      scrollToPageTop();

      detail.hidden = true;
      directory.hidden = false;
      viewer.classList.remove('is-loading');
      viewer.removeAttribute('aria-busy');
      setCurrentLink('');

      if (pushHistory) {
        window.history.pushState({ artasiaDocumentation: true }, '', url);
      }

      var heading = directory.querySelector('.artasia-documentation__navigation-group h3');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }

    function loadDocumentation(slug, url, pushHistory) {
      if (requestController) {
        requestController.abort();
      }
      scrollToPageTop();
      requestController = new AbortController();
      var activeController = requestController;
      viewer.classList.add('is-loading');
      viewer.setAttribute('aria-busy', 'true');
      status.textContent = 'Loading documentation.';

      var endpoint = restBase + encodeURIComponent(slug)
        + '?project_id=' + encodeURIComponent(projectId);

      return fetch(endpoint, {
        credentials: 'same-origin',
        signal: requestController.signal,
        headers: {
          Accept: 'application/json'
        }
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Unable to load documentation.');
          }
          return response.json();
        })
        .then(function (result) {
          content.innerHTML = result.html;
          setCurrentLink(result.slug);
          updateRelated(result.slug);
          directory.hidden = true;
          detail.hidden = false;

          detail.querySelectorAll('.artasia-documentation__all details').forEach(function (group) {
            group.open = false;
          });

          if (window.artasiaInitDocumentationGalleries) {
            window.artasiaInitDocumentationGalleries(content);
          }

          if (pushHistory) {
            window.history.pushState({
              artasiaDocumentation: true,
              slug: result.slug
            }, '', url);
          }

          var heading = content.querySelector('.artasia-documentation__title');
          if (heading) {
            heading.focus({ preventScroll: true });
          }
          status.textContent = result.title + ' loaded.';
        })
        .catch(function (error) {
          if (error.name !== 'AbortError') {
            status.textContent = 'The documentation could not be loaded. Please try again.';
          }
        })
        .finally(function () {
          if (requestController === activeController) {
            viewer.classList.remove('is-loading');
            viewer.removeAttribute('aria-busy');
          }
        });
    }

    viewer.addEventListener('click', function (event) {
      var documentationLink = event.target.closest('[data-documentation-slug]');
      var backLink = event.target.closest('[data-documentation-back]');

      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      if (documentationLink && viewer.contains(documentationLink)) {
        event.preventDefault();
        loadDocumentation(
          documentationLink.dataset.documentationSlug,
          documentationLink.href,
          true
        );
      } else if (backLink) {
        event.preventDefault();
        showDirectory(backLink.href, true);
      }
    });

    window.addEventListener('popstate', function () {
      var params = new URLSearchParams(window.location.search);
      var slug = params.get('documentation');
      var target = directoryLinks().find(function (link) {
        return link.dataset.documentationSlug === slug;
      });

      if (target) {
        loadDocumentation(target.dataset.documentationSlug, window.location.href, false);
      } else {
        showDirectory(window.location.href, false);
      }
    });

    var initial = directoryLinks().find(function (link) {
      return link.getAttribute('aria-current') === 'page';
    });
    if (initial) {
      scrollToPageTop();
      updateRelated(initial.dataset.documentationSlug);
    } else if (related) {
      related.hidden = true;
    }
  }

  window.artasiaInitDocumentationViewers = function (root) {
    var scope = root || document;
    scope.querySelectorAll('.artasia-documentation').forEach(initializeViewer);
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.artasiaInitDocumentationViewers(document);
  });

  window.addEventListener('elementor/frontend/init', function () {
    if (window.elementorFrontend && elementorFrontend.hooks) {
      elementorFrontend.hooks.addAction('frontend/element_ready/artasia_documentation.default', function ($scope) {
        window.artasiaInitDocumentationViewers($scope[0]);
        if (window.artasiaInitDocumentationGalleries) {
          window.artasiaInitDocumentationGalleries($scope[0]);
        }
      });
    }
  });
})();
