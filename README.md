# remark-autofix

[![Tests](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20CI/badge.svg)](https://github.com/tvquizphd/remark-autofix/actions?query=workflow%3A%22Node.js+CI%22)
[![Package](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20Package/badge.svg)](https://github.com/tvquizphd/remark-autofix/actions?query=workflow%3A%22Node.js+Package%22)

This project, `remark-autofix`, is a [remark](https://github.com/remarkjs/remark) plugin
to apply fixes from warnings raised by [retext](https://github.com/retextjs/retext) plugins.
The fixes are applied to the markdown abstract syntax tree when running
[remark-retext](https://github.com/remarkjs/remark-retext) in bridge mode.

## Installation

```shell
npm install remark-autofix
# or
yarn add remark-autofix
```

## Usage Examples

**NOTE** Calls to [processor.use](https://github.com/unifiedjs/unified#processoruseplugin-options)
must occur in the following order with the following aruements:

1. `use(remark2retext, unified().use(...).use(...)...)`
    - the repeated `use` calls marked by `...` must define a `retext` processor
    - the `retext` processor must emit vfile messages with `expected` values
2. `use(autofix)`


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

## License

[MIT licensed](./LICENSE)
