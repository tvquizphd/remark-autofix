const repeated = require("retext-repeated-words");
const spacing = require("retext-sentence-spacing");
const spell = require("retext-spell");

const remark2retext = require("remark-retext");
const english = require("retext-english");
const unified = require("unified");
const remark = require("remark");

const autofix = require(".");

describe("remark-autofix", () => {
  const retext_processors = new Map([
    [1, unified().use(english).use(repeated)]
  ]);
  const process = (input, i) => {
    const processor = remark().use(remark2retext, retext_processors.get(i))
    return processor.use(autofix).processSync(input).toString()
  };

  it("should remove doubled word, keeping link", () => {
    const input = "This link [link](https://example.com/) is duplicated.";
    const expected = "This [link](https://example.com/) is duplicated.\n";
    const output = process(input, 1);
    expect(output).toBe(expected);
  });

  it("should remove repeated words across two paragraphs", () => {
    const input = `A-well, a bird bird bird bird is the word

Ma ma mow, pa pa, ma ma mow, pa pa
Ma ma mow, pa pa, ma ma mow, pa pa
Ma ma mow, pa pa, ma ma mow, pa pa
Ma ma mow, pa pa, ma ma mow, pa pa
`;
    const expected = `A-well, a bird is the word

Ma ma mow, pa, ma mow, pa
Ma ma mow, pa, ma mow, pa
Ma ma mow, pa, ma mow, pa
Ma ma mow, pa, ma mow, pa
`;
    const output = process(input, 1);
    expect(output).toBe(expected);
  });
});

