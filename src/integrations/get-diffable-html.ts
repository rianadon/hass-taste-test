// Based on @open-wc/semantic-dom-diff, MIT license
//
// The code has been modified to traverse shadow DOM & find Lit and Polymer attributes

const DEFAULT_IGNORE_TAGS = ['script', 'style'];
const DEFAULT_IGNORE_CHILDREN = [
  'ha-icon', 'ha-slider', // Home Assistant elements
  'paper-input', // Polymer elements
];
const DEFAULT_EMPTY_ATTRS = ['class', 'id'];
const VOID_ELEMENTS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr'];

interface IgnoreAttributesForTags {
  /** tags on which to ignore the given attributes */
  tags: string[]
  /** attributes to ignore for the given tags */
  attributes: string[]
}

interface DiffOptions {
  /** array of attributes to ignore, when given a string that attribute will be ignored on all tags
   *  when given an object of type `IgnoreAttributesForTags`, you can specify on which tags to ignore which attributes */
  ignoreAttributes: (string | IgnoreAttributesForTags)[]
  /** array of tags to ignore, these tags are stripped from the output */
  ignoreTags: string[]
  /** array of tags whose children to ignore, the children of these tags are stripped from the output */
  ignoreChildren: string[]
  /** array of attributes which should be removed when empty.
   * Be careful not to add any boolean attributes here (e.g. `hidden`) unless you know what you're doing */
  stripEmptyAttributes: string[]
  /** whether to strip attributes from Lit & Polymer with undefined values */
  stripUndefinedAttributes: boolean
}

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
function getDiffableHTML(container: Node, options?: DiffOptions): string {
  const ignoreAttributes = options?.ignoreAttributes
    ? options.ignoreAttributes.filter(e => typeof e === 'string') as string[]
    : [];
  const ignoreAttributesForTags = options?.ignoreAttributes
    ? options.ignoreAttributes.filter(e => typeof e !== 'string') as IgnoreAttributesForTags[]
    : [];
  const ignoreTags = [...(options?.ignoreTags || []), ...DEFAULT_IGNORE_TAGS];
  const ignoreChildren = [...(options?.ignoreChildren || []), ...DEFAULT_IGNORE_CHILDREN];
  const stripEmptyAttributes = options?.stripEmptyAttributes || DEFAULT_EMPTY_ATTRS;
  const stripUndefinedAttributes = options?.stripUndefinedAttributes ?? true;
  const escapeAttributes = /(&|")/g;
  const escapeAttributesFn = (match: string) => (match === '&' ? '&amp;' : '&quot;');

  let text = '';

  function walk(current: Node, depth: number) {

    function getIndentation(): string {
      return '  '.repeat(depth);
    }

    function printText(textNode: Text) {
      const value = textNode.nodeValue!.trim();
      if (value !== '') {
        text += `${getIndentation()}${value}\n`;
      }
    }

    function getTagName(node: Node) {
      // Use original tag if available via data-tag-name attribute (use-case for scoped elements)
      // See packages/scoped-elements for more info
      if (node instanceof Element) {
        return node.getAttribute('data-tag-name') || node.localName;
      }
      return node.nodeName.toLowerCase();
    }

    function children(node: Node) {
      if (ignoreChildren.includes(getTagName(node))) return [];

      let children = [...node.childNodes];
      if (node instanceof Element && node.shadowRoot) children = [...node.shadowRoot.childNodes, ...children];
      return children.filter(node => node.nodeType == Node.ELEMENT_NODE || node.nodeType == Node.TEXT_NODE)
    }

    /** An element's classList, sorted, as string */
    function getClassListValueString(el: Element): string {
      // @ts-ignore
      return [...el.classList.values()].sort().join(' ');
    }

    function shouldStripAttribute({ name, value }: Attr) {
      return stripEmptyAttributes.includes(name) && value.trim() === '';
    }

    function getAttributeString(el: Element, { name, value }: Attr) {
      if (shouldStripAttribute({ name, value } as Attr)) return '';
      if (name === 'class') return ` class="${getClassListValueString(el)}"`;
      return ` ${name}="${value.replace(escapeAttributes, escapeAttributesFn)}"`;
    }

    function isIgnoredAttribute(el: Element, attr: Attr): boolean {
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
    }

    const sortAttribute = (a: Attr, b: Attr) => a.name.localeCompare(b.name);

    function getAttributes(el: any): Attr[] {
      const attributes = [...el.attributes] as Attr[]

      let ignoreAttributeNames: string[] = []; // Redundant HTML element properties
      let propertyNames = []; // Names of properties defined by Lit/Polymer
      if (el.properties) {
        propertyNames = Object.keys(el.properties).filter(p => !el.properties[p].readOnly)
        ignoreAttributeNames = propertyNames
      } else if (el.constructor.elementProperties) {
        const props = el.constructor.elementProperties
        propertyNames = [...props.keys()].filter((p: string) => props.get(p).attribute !== false)
        ignoreAttributeNames = [...props.entries()].map(([name, p]) => typeof p.attribute === 'string' ? p.attribute : name)
      } else {
        return attributes
      }

      if (stripUndefinedAttributes) propertyNames = propertyNames.filter(p => typeof el[p] !== 'undefined')
      return [
        ...attributes.filter(({name}) => !ignoreAttributeNames.includes(name)),
        ...propertyNames.map(name => ({ name, value: String(el[name]) } as Attr))
      ]
    }

    function getAttributesString(el: Element) {
      const attributes = getAttributes(el)
        .filter(attr => !isIgnoredAttribute(el, attr))
        .sort(sortAttribute);

      return attributes.map(attr => getAttributeString(el, attr)).join('');
    }

    function printOpenElement(el: Element) {
      const tag = getTagName(el)
      text += `${getIndentation()}<${tag}${getAttributesString(el)}>`;
      if (children(el).length > 0 || VOID_ELEMENTS.includes(tag)) text += '\n';
      if (ignoreChildren.includes(tag)) text += '…';
    }

    function onNodeStart(node: Node) {
      if (node instanceof Text) {
        printText(node);
      } else if (node instanceof Element) {
        printOpenElement(node);
      } else {
        throw new Error(`Unknown node type: ${node}`);
      }
    }

    function printCloseElement(el: Element) {
      if (VOID_ELEMENTS.includes(getTagName(el))) return;

      if (children(el).length > 0) text += getIndentation();
      text += `</${getTagName(el)}>\n`;
    }

    function onNodeEnd(node: Node) {
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

  walk(container, 0)
  return text;
}
