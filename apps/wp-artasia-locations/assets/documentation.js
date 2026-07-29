(function () {
  function initializeViewer(viewer) {
    if (viewer.dataset.artasiaDocumentationInitialized === 'true') {
      return;
    }
    viewer.dataset.artasiaDocumentationInitialized = 'true';

    var projectId = viewer.dataset.projectId;
    var restBase = viewer.dataset.restBase;
    var content = viewer.querySelector('.artasia-documentation__content');
    var status = viewer.querySelector('.artasia-documentation__status');
    var links = Array.prototype.slice.call(
      viewer.querySelectorAll('[data-documentation-slug]')
    );
    var requestController = null;

    if (!projectId || !restBase || !content || !links.length || !window.fetch) {
      return;
    }

    function setCurrentLink(slug) {
      links.forEach(function (link) {
        if (link.dataset.documentationSlug === slug) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    function loadDocumentation(slug, url, pushHistory) {
      if (requestController) {
        requestController.abort();
      }
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
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        loadDocumentation(link.dataset.documentationSlug, link.href, true);
      });
    });

    window.addEventListener('popstate', function () {
      var params = new URLSearchParams(window.location.search);
      var slug = params.get('documentation');
      var target = links.find(function (link) {
        return link.dataset.documentationSlug === slug;
      });

      if (!target) {
        target = links[0];
      }
      if (target) {
        loadDocumentation(target.dataset.documentationSlug, window.location.href, false);
      }
    });
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
