# remark-autofix

![Node.js CI](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20CI/badge.svg)
![Node.js Package](https://github.com/tvquizphd/remark-autofix/workflows/Node.js%20Package/badge.svg)

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

### Fix repeated words in Markdown

With [retext-repeated-words](https://github.com/retextjs/retext-repeated-words):

```js
const remark = require('remark');
const unified = require('unified');
const repeated = require('retext-repeated-words');
const remark2retext = require('remark-retext');
const autofix = require('remark-autofix');

const inputMarkdown = `## Example
This link [link](https://example.com/) is duplicated.
`
const processor = remark().use(autofix).use(
  remark2retext,
  unified().use(english).use(repeated)
);

const outputMarkdown = processor.processSync(inputMarkdown).toString();
```

The `outputMarkdown` should be:

```md
## Example

This [link](https://example.com/) is duplicated.

```

## License

[MIT licensed](./LICENSE)
