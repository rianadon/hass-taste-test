const DEFAULT_IGNORE_TAGS = ['script', 'style', 'svg'];
const DEFAULT_EMPTY_ATTRS = ['class', 'id'];
const VOID_ELEMENTS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr'];

/**
 * @typedef IgnoreAttributesForTags
 * @property {string[]} tags tags on which to ignore the given attributes
 * @property {string[]} attributes attributes to ignore for the given tags
 */

/**
 * @typedef DiffOptions
 * @property {(string | IgnoreAttributesForTags)[]} [ignoreAttributes]
 *  array of attributes to ignore, when given a string that attribute will be ignored on all tags
 *  when given an object of type `IgnoreAttributesForTags`, you can specify on which tags to ignore which attributes
 * @property {string[]} [ignoreTags] array of tags to ignore, these tags are stripped from the output
 * @property {string[]} [ignoreChildren] array of tags whose children to ignore, the children of
 *   these tags are stripped from the output
 * @property {string[]} [stripEmptyAttributes] array of attributes which should be removed when empty.
 *   Be careful not to add any boolean attributes here (e.g. `hidden`) unless you know what you're doing
 */

/**
 * Restructures given HTML string, returning it in a format which can be used for comparison:
 * - whitespace and newlines are normalized
 * - tags and attributes are printed on individual lines
 * - comments, style, script and svg tags are removed
 * - additional tags and attributes can optionally be ignored
 *
 * See README.md for details.
 *
 * @example
 * import getDiffableHTML from '@open-wc/semantic-dom-diff';
 *
 * const htmlA = getDiffableHTML(`... some html ...`, { ignoredAttributes: [], ignoredTags: [], ignoreChildren: [] });
 * const htmlB = getDiffableHTML(`... some html ...`);
 *
 * // use regular string comparison to spot the differences
 * expect(htmlA).to.equal(htmlB);
 *
 * @param {Node} container
 * @param {DiffOptions} [options]
 * @returns {string} html restructured in a diffable format
 */
function getDiffableHTML(container, options = {}) {
  const ignoreAttributes = /** @type {string[]} */ (options.ignoreAttributes
    ? options.ignoreAttributes.filter(e => typeof e === 'string')
    : []);
  const ignoreAttributesForTags = /** @type {IgnoreAttributesForTags[]} */ (options.ignoreAttributes
    ? options.ignoreAttributes.filter(e => typeof e !== 'string')
    : []);
  const ignoreTags = [...(options.ignoreTags || []), ...DEFAULT_IGNORE_TAGS];
  const ignoreChildren = options.ignoreChildren || [];
  const stripEmptyAttributes = options.stripEmptyAttributes || DEFAULT_EMPTY_ATTRS;
  const escapeAttributes = /(&|")/g;
  /** @param {string} match */
  const escapeAttributesFn = match => (match === '&' ? '&amp;' : '&quot;');

  let text = '';

  function walk(current, depth) {

    /** @returns {string} */
    function getIndentation() {
      return '  '.repeat(depth);
    }

    /**
     * @param {Text} textNode
     */
    function printText(textNode) {
      const value = textNode.nodeValue.trim();
      if (value !== '') {
        text += `${getIndentation()}${value}\n`;
      }
    }

    /** @param {Node} node */
    function getTagName(node) {
      // Use original tag if available via data-tag-name attribute (use-case for scoped elements)
      // See packages/scoped-elements for more info
      if (node instanceof Element) {
        return node.getAttribute('data-tag-name') || node.localName;
      }
      return node.nodeName.toLowerCase();
    }

    /**
     * An element's classList, sorted, as string
     * @param  {Element} el Element
     * @return {String}
     */
    function getClassListValueString(el) {
      // @ts-ignore
      return [...el.classList.values()].sort().join(' ');
    }

    function shouldStripAttribute({ name, value }) {
      return stripEmptyAttributes.includes(name) && value.trim() === '';
    }

    /**
     * @param {Element} el
     * @param {Attr} attr
     */
    function getAttributeString(el, { name, value }) {
      if (shouldStripAttribute({ name, value })) return '';
      if (name === 'class') return ` class="${getClassListValueString(el)}"`;
      return ` ${name}="${value.replace(escapeAttributes, escapeAttributesFn)}"`;
    }

    /**
     * @param {Element} el
     * @return {(attr: Attr) => Boolean}
     */
    function isIgnoredAttribute(el) {
      return function isIgnoredElementAttibute(attr) {
        if (ignoreAttributes.includes(attr.name) || shouldStripAttribute(attr)) {
          return true;
        }

        return !!ignoreAttributesForTags.find(e => {
          if (!e.tags || !e.attributes) {
            throw new Error(
              `An object entry to ignoreAttributes should contain a 'tags' and an 'attributes' property.`,
            );
          }
          return e.tags.includes(getTagName(el)) && e.attributes.includes(attr.name);
        });
      };
    }

    const sortAttribute = (a, b) => a.name.localeCompare(b.name);

    /** @param {Element} el */
    function getAttributesString(el) {
      const attributes = Array.from(el.attributes)
        .filter(el => !isIgnoredAttribute(el))
        .sort(sortAttribute);

      return attributes.map(attr => getAttributeString(el, attr)).join('');
    }

    /** @param {Element} el */
    function printOpenElement(el) {
      text += `${getIndentation()}<${getTagName(el)}${getAttributesString(el)}>`;
      if (children(el).length > 0) text += '\n';
    }

    /**
     * @param {Node} node
     */
    function onNodeStart(node) {
      if (node instanceof Text) {
        printText(node);
      } else if (node instanceof Element) {
        printOpenElement(node);
      } else {
        throw new Error(`Unknown node type: ${node}`);
      }
    }

    /** @param {Element} el */
    function printCloseElement(el) {
      if (VOID_ELEMENTS.includes(getTagName(el))) return;

      if (children(el).length > 0) text += getIndentation();
      text += `</${getTagName(el)}>\n`;
    }

    /** @param {Node} node */
    function onNodeEnd(node) {
      if (node instanceof Element) {
        printCloseElement(node);
      }
    }

    // don't print this node if we should ignore it
    if (ignoreTags.includes(getTagName(current))) return;

    onNodeStart(current);
    for (const child of children(current)) { walk(child, depth+1); }
    onNodeEnd(current);
  }

  console.log('container', container)
  walk(container, 0)
  return text;
}

/** @param {Node} node */
function children(node) {
  let children = [...node.childNodes];
  if (node.shadowRoot) children = [...node.shadowRoot.childNodes, ...children];
  return children.filter(node => node.nodeType == Node.ELEMENT_NODE || node.nodeType == Node.TEXT_NODE)
}
