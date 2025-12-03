(function (maestro) {
    const INVALID_TAGS = new Set(['noscript', 'script', 'br', 'img', 'svg', 'g', 'path', 'style'])

    const isInvalidTag = (node) => {
        return INVALID_TAGS.has(node.tagName.toLowerCase())
    }

    // Synthetic nodes do not truly have a visual representation in the DOM, but they are still visible to the user.
    const isSynthetic = (node) => {
        return node.tagName.toLowerCase() === 'option'
    }

    const getNodeText = (node) => {
        switch (node.tagName.toLowerCase()) {
            case 'input':
                return node.value || node.placeholder || node.ariaLabel || ''

            case 'select':
                return Array.from(node.selectedOptions).map((option) => option.text).join(', ')

            default:
                // First try to get text from child text nodes
                const childNodes = [...(node.childNodes || [])].filter(node => node.nodeType === Node.TEXT_NODE)
                const textContent = childNodes.map(node => node.textContent.replace('\n', '').replace('\t', '')).join('')

                // If no text content, try aria-label (important for Flutter semantic elements)
                if (!textContent && node.ariaLabel) {
                    return node.ariaLabel
                }

                // Also check for aria-label attribute directly (some browsers)
                if (!textContent && node.getAttribute && node.getAttribute('aria-label')) {
                    return node.getAttribute('aria-label')
                }

                return textContent
        }
    }

    const getIndexInParent = (node) => {
        if (!node.parentElement) return -1;

        const siblings = Array.from(node.parentElement.children);
        return siblings.indexOf(node);
    }

    const getSyntheticNodeBounds = (node) => {
        // If the node is synthetic, we return bounds in a special coordinate space that doesn't interfere
        // with the rest of the DOM. We do this by adding 100000 offset to the x and y coordinates.

        const idx = getIndexInParent(node);

        const width = 100;
        const height = 20;

        const offset = 100000;

        const x = offset;
        const y = offset + (idx * height);

        const l = x;
        const t = y;
        const r = x + width;
        const b = y + height;

        return `[${Math.round(l)},${Math.round(t)}][${Math.round(r)},${Math.round(b)}]`
    }

    const getNodeBounds = (node) => {
        if (isSynthetic(node)) {
            return getSyntheticNodeBounds(node);
        }

        const rect = node.getBoundingClientRect()
        const vpx = maestro.viewportX;
        const vpy = maestro.viewportY;
        const vpw = maestro.viewportWidth || window.innerWidth;
        const vph = maestro.viewportHeight || window.innerHeight;

        const scaleX = vpw / window.innerWidth;
        const scaleY = vph / window.innerHeight;
        const l = rect.x * scaleX + vpx;
        const t = rect.y * scaleY + vpy;
        const r = (rect.x + rect.width) * scaleX + vpx;
        const b = (rect.y + rect.height) * scaleY + vpy;

        return `[${Math.round(l)},${Math.round(t)}][${Math.round(r)},${Math.round(b)}]`
    }

    const isDocumentLoading = () => document.readyState !== 'complete'

    const traverse = (node, includeChildren = true) => {
        if (!node || isInvalidTag(node)) return null

        // Get children from both regular DOM and shadow DOM
        let childNodes = [...(node.children || [])];

        // Also traverse shadow DOM if present (important for Flutter web)
        if (node.shadowRoot) {
            childNodes = childNodes.concat([...node.shadowRoot.children]);
        }

        const children = includeChildren
            ? childNodes.map(child => traverse(child)).filter(el => !!el)
            : []

        const attributes = {
            text: getNodeText(node),
            bounds: getNodeBounds(node),
        }

        // If this is an <option> element, we only want to include it if the parent <select> element is focused.
        if (node.tagName.toLowerCase() === 'option' && !node.parentElement.matches(':focus-within')) {
            return null;
        }

        // Extract custom identifiers based on configured attributes
        // Only extract attributes that are explicitly configured in identifierConfig
        if (node.getAttribute && maestro.identifierConfig && Object.keys(maestro.identifierConfig).length > 0) {
            for (const htmlAttr in maestro.identifierConfig) {
                const value = node.getAttribute(htmlAttr)
                if (value !== null) {
                    // Store with HTML attribute name for filtering
                    attributes[htmlAttr] = value

                    // Also store with YAML key for backwards compatibility
                    const yamlKey = maestro.identifierConfig[htmlAttr]
                    if (yamlKey) {
                        attributes[yamlKey] = value
                    }
                }
            }
        }

        if (!!node.id || !!node.ariaLabel || !!node.name || !!node.title || !!node.htmlFor || !!node.attributes['data-testid']) {
            const title = typeof node.title === 'string' ? node.title : null
            attributes['resource-id'] = node.id || node.ariaLabel || node.name || title || node.htmlFor || node.attributes['data-testid']?.value
        }

        if (node.tagName.toLowerCase() === 'body') {
            attributes['is-loading'] = isDocumentLoading()
        }

        if (node.selected) {
            attributes['selected'] = true
        }

        if (isSynthetic(node)) {
            attributes['synthetic'] = true
            attributes['ignoreBoundsFiltering'] = true
        }

        return {
            attributes,
            children,
        }
    }

    // -------------- Public API --------------
    maestro.viewportX = 0;
    maestro.viewportY = 0;
    maestro.viewportWidth = 0;
    maestro.viewportHeight = 0;

    // Identifier configuration (set by driver, do NOT set default here)
    // maestro.identifierConfig will be injected by WebDriver/CdpWebDriver

    maestro.getContentDescription = () => {
        // Start traversal from document.body
        const bodyResult = traverse(document.body);

        // For Flutter web apps, also check flutter-specific elements that might have shadow DOM
        const flutterView = document.querySelector('flutter-view');
        const glassPane = document.querySelector('flt-glass-pane');

        // If Flutter elements exist and have shadow roots, merge their children
        if (flutterView && flutterView.shadowRoot) {
            const flutterChildren = [...flutterView.shadowRoot.children]
                .map(child => traverse(child))
                .filter(el => !!el);
            if (bodyResult && flutterChildren.length > 0) {
                bodyResult.children = bodyResult.children.concat(flutterChildren);
            }
        }

        if (glassPane && glassPane.shadowRoot) {
            const glassPaneChildren = [...glassPane.shadowRoot.children]
                .map(child => traverse(child))
                .filter(el => !!el);
            if (bodyResult && glassPaneChildren.length > 0) {
                bodyResult.children = bodyResult.children.concat(glassPaneChildren);
            }
        }

        return bodyResult;
    }

    maestro.queryCss = (selector) => {
        // Returns a list of matching elements for the given CSS selector.
        // Does not include children of discovered elements.
        const elements = document.querySelectorAll(selector);

        return Array.from(elements).map(el => {
            return traverse(el, false);
        });
    }

    maestro.tapOnSyntheticElement = (x, y) => {
        // This function is used to tap on synthetic elements like <option> that do not have a visual representation.
        // It will return the bounds of the synthetic element in a special coordinate space.

        const syntheticElements = Array.from(document.querySelectorAll('option'));
        if (syntheticElements.length === 0) {
            throw new Error('No synthetic elements found');
        }

        for (const option of syntheticElements) {
            const bounds = getSyntheticNodeBounds(option);
            const [left, top] = bounds.match(/\d+/g).map(Number);
            const [right, bottom] = bounds.match(/\d+/g).slice(2).map(Number);

            if (x >= left && x <= right && y >= top && y <= bottom) {
                const select = option.parentElement;
                option.selected = true;

                // Without this, browser will not update the select element's value.
                select.dispatchEvent(new Event("change", { bubbles: true }));

                // This is needed to hide the <select> dropdown after selection.
                select.blur();

                return;
            }
        }
    }

    // https://stackoverflow.com/a/5178132
    maestro.createXPathFromElement = (domElement) => {
        var allNodes = document.getElementsByTagName('*');
        for (var segs = []; domElement && domElement.nodeType == 1; domElement = domElement.parentNode) {
            if (domElement.hasAttribute('id')) {
                var uniqueIdCount = 0;
                for (var n = 0; n < allNodes.length; n++) {
                    if (allNodes[n].hasAttribute('id') && allNodes[n].id == domElement.id) uniqueIdCount++;
                    if (uniqueIdCount > 1) break;
                }
                if (uniqueIdCount == 1) {
                    segs.unshift('id("' + domElement.getAttribute('id') + '")');
                    return segs.join('/');
                } else {
                    segs.unshift(domElement.localName.toLowerCase() + '[@id="' + domElement.getAttribute('id') + '"]');
                }
            } else if (domElement.hasAttribute('class')) {
                segs.unshift(domElement.localName.toLowerCase() + '[@class="' + domElement.getAttribute('class') + '"]');
            } else {
                for (i = 1, sib = domElement.previousSibling; sib; sib = sib.previousSibling) {
                    if (sib.localName == domElement.localName) i++;
                }
                segs.unshift(domElement.localName.toLowerCase() + '[' + i + ']');
            }
        }
        return segs.length ? '/' + segs.join('/') : null;
    }

    // -------------- Flutter Web Scrolling Support --------------

    maestro.isFlutterApp = () => {
        // Detect if this is a Flutter web app by checking for Flutter-specific elements
        const flutterView = document.querySelector('flutter-view');
        const glassPane = document.querySelector('flt-glass-pane');
        const fltRenderer = document.querySelector('[flt-renderer]');

        return !!(flutterView || glassPane || fltRenderer);
    }

    /**
     * Find the element at the given coordinates that should receive scroll events.
     * For Flutter web, this finds the appropriate semantic node or flutter element.
     */
    maestro.getScrollTargetAt = (x, y) => {
        const elementAtPoint = document.elementFromPoint(x, y);
        if (elementAtPoint) {
            return elementAtPoint;
        }

        // Fallback to flutter-view or flt-glass-pane
        return document.querySelector('flutter-view') ||
            document.querySelector('flt-glass-pane') ||
            document.body;
    }

    /**
     * Smooth animated scrolling for Flutter web with easing.
     * Dispatches wheel events at the specified coordinates to scroll the element under that point.
     */
    maestro.smoothScrollFlutter = (pixels, duration = 500, x = null, y = null) => {
        const scrollX = x !== null ? x : window.innerWidth / 2;
        const scrollY = y !== null ? y : window.innerHeight / 2;

        const target = maestro.getScrollTargetAt(scrollX, scrollY);
        if (!target) {
            return false;
        }

        const start = performance.now();
        let last = 0;

        function animate(now) {
            const progress = Math.min((now - start) / duration, 1);

            // Cubic ease-in-out for natural animation
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const delta = eased * pixels - last;
            last = eased * pixels;

            if (Math.abs(delta) > 0.01) {
                // Dispatch mouse events to ensure Flutter recognizes the scroll target
                target.dispatchEvent(new MouseEvent('mouseover', {
                    clientX: scrollX,
                    clientY: scrollY,
                    bubbles: true
                }));
                target.dispatchEvent(new MouseEvent('mousemove', {
                    clientX: scrollX,
                    clientY: scrollY,
                    bubbles: true
                }));

                // Dispatch wheel event at the specified coordinates
                target.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: delta,
                    deltaX: 0,
                    deltaZ: 0,
                    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
                    clientX: scrollX,
                    clientY: scrollY,
                    screenX: scrollX,
                    screenY: scrollY,
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    detail: 0
                }));
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);
        return true;
    };

    /**
     * Direct scroll method that tries multiple approaches for Flutter web.
     * This is a fallback if the animated scroll doesn't work.
     */
    maestro.directScrollFlutter = (deltaY, x, y) => {
        const target = maestro.getScrollTargetAt(x, y);
        if (!target) {
            return false;
        }

        // Try dispatching directly to the flutter-view canvas
        const flutterView = document.querySelector('flutter-view');
        const glassPane = document.querySelector('flt-glass-pane');
        const canvas = document.querySelector('canvas');

        const targets = [target, flutterView, glassPane, canvas].filter(Boolean);

        targets.forEach((t) => {
            // Try pointer events (Flutter web uses these)
            t.dispatchEvent(new PointerEvent('pointerdown', {
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                bubbles: true
            }));

            // Wheel event
            t.dispatchEvent(new WheelEvent('wheel', {
                deltaY: deltaY,
                deltaX: 0,
                deltaMode: 0,
                clientX: x,
                clientY: y,
                bubbles: true,
                cancelable: true
            }));

            t.dispatchEvent(new PointerEvent('pointerup', {
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                bubbles: true
            }));
        });

        return true;
    };
}(window.maestro = window.maestro || {}));
