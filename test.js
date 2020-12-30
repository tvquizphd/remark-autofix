const repeated = require("retext-repeated-words");
const spacing = require("retext-sentence-spacing");
const spell = require("retext-spell");

const remark2retext = require("remark-retext");
const english = require("retext-english");
const unified = require("unified");
const remark = require("remark");

const autofix = require(".");

describe("remark-autofix", () => {
  const processor = remark().use(autofix).use(
    remark2retext,
    unified().use(english).use(repeated)
  );
  const process = input => processor.processSync(input).toString();

  it("should remove repeated words, keeping links", () => {
    const input = "This link [link](https://example.com/) is duplicated.";
    const expected = "This [link](https://example.com/) is duplicated.\n";
    const output = process(input);
    expect(output).toBe(expected);
  });

});

