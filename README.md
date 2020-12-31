# remark-autofix

[![Tests](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20CI/badge.svg)](https://github.com/tvquizphd/remark-autofix/actions?query=workflow%3A%22Node.js+CI%22)
[![Package](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20Package/badge.svg)](https://github.com/tvquizphd/remark-autofix/actions?query=workflow%3A%22Node.js+Package%22)

This project, `remark-autofix`, is a [remark](https://github.com/remarkjs/remark) plugin
to apply fixes from warnings raised by [retext](https://github.com/retextjs/retext) plugins.
The fixes are applied to the markdown abstract syntax tree when running
[remark-retext](https://github.com/remarkjs/remark-retext) in bridge mode.

## Supported Plugins

By default, this plugin only fixes `vfile` messages emitted from the following `retext` plugins:

- [retext-spell](https://github.com/retextjs/retext-spell)
- [retext-quotes](https://github.com/retextjs/retext-quotes)
- [retext-diacritics](https://github.com/retextjs/retext-diacritics)
- [retext-contractions](https://github.com/retextjs/retext-contractions)
- [retext-repeated-words](https://github.com/retextjs/retext-repeated-words)
- [retext-sentence-spacing](https://github.com/retextjs/retext-sentence-spacing)
- [retext-indefinite-article](https://github.com/retextjs/retext-indefinite-article)
- [retext-redundant-acronyms](https://github.com/retextjs/retext-redundant-acronyms)

By passing the options parameter, following the [API](https://github.com/tvquizphd/remark-autofix#API), this plugin is tested to support:

- [retext-profanities](https://github.com/retextjs/retext-profanities)

## Installation

```shell
npm install remark-autofix
# or
yarn add remark-autofix
```

## Usage Examples

**NOTE** Chained calls to a remark processor's [use](https://github.com/unifiedjs/unified#processoruseplugin-options)
method must occur in the following order with the following arguments:

1. `use(remark2retext, retextProcessor)`
    - The `retextProcessor` must define a `retext` processor, which should emit `vfile` messages.
2. `use(autofix[, options])`
    - for the options parameter, see the [API](https://github.com/tvquizphd/remark-autofix#API).

### Fix repeated words in Markdown

With [retext-repeated-words](https://github.com/retextjs/retext-repeated-words):

```js
const remark = require('remark');
const unified = require('unified');
const english = require('retext-english');
const remark2retext = require('remark-retext');
const repeated = require('retext-repeated-words');
const autofix = require('remark-autofix');

const inputMarkdown = `## Example
This link [link](https://example.com/) is not not duplicated.
`
const processor = remark().use(
  remark2retext, unified().use(english).use(repeated)
).use(autofix);

const outputMarkdown = processor.processSync(inputMarkdown).toString();
```

The `outputMarkdown` should be:

```md
## Example

This [link](https://example.com/) is not duplicated.

```

## API

### `remark().use(remark2retext, retextProcessor).use(autofix, options)`

###### `remark` and `remark2retext`

These must be imported from `remark` and `remark-retext`.

###### `retextProcessor`

A `retext` processor created by chaining `unified`'s `use` method on:
  - a parser such as `retext-english`
  - one or more supported `retext` plugins to emit `vfile` messages

###### `autofix`

This is imported from this package, `remark-autofix`.
It applies fixes to markdown from all supported `vfile` messages emitted from `retextProcessor`.

###### `options`

This is an optional object with one `fixers` property containing an object defined below.

###### `options.fixers`

This is an object to map `retext` plugin names to custom functions.
See [supported plugin names](https://github.com/tvquizphd/remark-autofix#Supported%20Plugins).

Each function provided in `fixers` should have the following signature:

Parameters:
  - message ([vfile-message](https://github.com/vfile/vfile-message))

Return:
  - (String or null)

For supported plugins, each `message` has the following relevant custom properties in addition to the `vfile-message` standard:
  - `actual` string identifying the string in the `vfile` that should be altered or removed.
  - `expected` array of strings. For certain plugins, the array may be empty to indicate that the `actual` value should be removed.

If null is returned, the message will be ignored. If a string is returned, this plugin will attempt to fix `mdast` `Literal` nodes within `message.location`, replacing `actual` text with the returned text. If multiple messages have overlapping `location` ranges, this plugin will cover the full extent of the overlapping `location` ranges with the mode of returned strings for that `location` range, preserving the `mdast` nodes with the most formatting. If there is no mode, the string from the first message raised will be used.

## Ecosystem

This repository works in conjunction with

- the `remark` processor
- the `remark-retext` processor
- A `retext` processor created by chaining [unified](https://github.com/unifiedjs/unified)'s `use` method on:
    - a parser such as [retext-english](https://github.com/retextjs/retext/tree/main/packages/retext-english)
    - one or more `retext` [supported](https://github.com/tvquizphd/remark-autofix/blob/main/README.md#supported-plugins) plugins to emit `vfile` messages

The plugin works with [`mdast`](https://github.com/syntax-tree/mdast) to represent markdown and [`nlcst`](https://github.com/syntax-tree/nlcst) to represent text.

## License

[MIT licensed](./LICENSE)
