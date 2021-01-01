const spell = require("retext-spell");
const quotes = require("retext-quotes");
const dictionary_en = require("dictionary-en");
const diacritics = require("retext-diacritics");
const profanities = require("retext-profanities");
const repeated = require("retext-repeated-words");
const spacing = require("retext-sentence-spacing");
const contractions = require("retext-contractions");
const indefiniteArticle = require("retext-indefinite-article");
const redundantAcronyms = require("retext-redundant-acronyms");

const remark2retext = require("remark-retext");
const english = require("retext-english");
const unified = require("unified");
const remark = require("remark");

const autofix = require(".");

describe("remark-autofix", () => {
  const retext_processors = new Map([
    ['none',
      unified().use(english)
    ],
    ['repeated',
      unified().use(english).use(repeated)
    ],
    ['repeated-redundant-acronyms',
      unified().use(english).use(repeated)
      .use(redundantAcronyms)
    ],
    ['repeated-spell',
      unified().use(english).use(repeated)
      .use(spell, dictionary_en)
    ],
    ['spacing-spell',
      unified().use(english).use(spacing)
      .use(spell, dictionary_en)
    ],
    ['spell-contractions',
      unified().use(english).use(spell, dictionary_en)
      .use(contractions, {straight: true})
    ],
    ['quotes-contractions',
      unified().use(english)
      .use(quotes, {preferred: 'straight'})
      .use(contractions, {straight: true})
    ],
    ['indefinite-article-repeated',
      unified().use(english)
      .use(indefiniteArticle).use(repeated)
    ],
    ['indefinite-article-diacritics',
      unified().use(english)
      .use(indefiniteArticle).use(diacritics)
    ],
    ['profanities',
      unified().use(english).use(profanities)
    ]
  ]);

  const process = async (input, i, options={}) => {
    const processor = remark().use(remark2retext, retext_processors.get(i))
    return (await processor.use(autofix, options).process(input)).toString()
  };

  const process_callback = (input, i, options={}, callback=null) => {
    const processor = remark().use(remark2retext, retext_processors.get(i))
    return processor.use(autofix, options).process(input, callback)
  };

  /*
   * Test repeated words
   */

  it("remove doubled word, keeping link", async () => {
    const input = `This link [link](https://example.com/) is not not duplicated.
`;
    const expected = `This [link](https://example.com/) is not duplicated.
`;
    const output = await process(input, 'repeated');
    expect(output).toBe(expected);
  });

  it("remove doubled word from heading and list, keeping link", async () => {
    const input = `## Repeated heading heading

*   *here* here is a link [link](https://example.com/)
*   here **here** is another link [link](https://example.com/)
`;
    const expected = `## Repeated heading

*   *here* is a [link](https://example.com/)
*   **here** is another [link](https://example.com/)
`;
    const output = await process(input, 'repeated', {debug: true});
    expect(output).toBe(expected);
  });

  it("remove repeated words across two paragraphs", async () => {
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
    const output = await process(input, 'repeated');
    expect(output).toBe(expected);
  });

  /*
   * Test redundant acronyms and repeated words
   */

  it("remove repeated redundant acronym", async () => {
    const input = `I joined IRC IRC chat over the LAN LAN network.
`;
    const expected = `I joined IRC over the LAN.
`;
    const output = await process(input, 'repeated-redundant-acronyms');
    expect(output).toBe(expected);
  });

  it("remove redundant acronym followed by repeated word", async () => {
    const input = `I joined IRC chat chat over the LAN network network.
`;
    const expected = `I joined IRC over the LAN.
`;
    const output = await process(input, 'repeated-redundant-acronyms');
    expect(output).toBe(expected);
  });

  /*
   * Test spelling and repeated words
   */

  it("replace repeated mispelled word with single correct word", async () => {
    const input = `I yamm yamm what I yamm yamm.
`;
    const expected = `I yam what I yam.
`;
    const output = await process(input, 'repeated-spell');
    expect(output).toBe(expected);
  });

  /*
   * Test repeated words and indefinite articles
   */

  it("replace many incorrect indefinite articles with single correct indefinite article", async () => {
    const input = `Eat a a a a apple an an an an day.
`;
    const expected = `Eat an apple a day.
`;
    const output = await process(input, 'indefinite-article-repeated');
    expect(output).toBe(expected);
  });

  /*
   * Test sentence spacing and spelling
   */

  it("fix sentence spacing and spelling", async () => {
    const input = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.  Nulla pharetra erat purus, eget congue justo laoreet id.
Nunc quis tempor nunc, in varius ante.  Aenean consectetur lacus sed odio lobortis, quis finibus tortor sagittis.
`;
    const expected = `Lore gypsum dolor sit met, consectetur adipiscing elite. Null pharetra drat Purus, get tongue gusto laoreet id.
Nun ques temper nun, in varies ante. Aegean consectetur LAC'S red Odin lobortis, ques minibus torpor sagittis.
`;
    const output = await process(input, 'spacing-spell');
    expect(output).toBe(expected);
  });

  it("fix same spelling mistake in multiple paragraphs", async () => {
    const input = `spel
spel

spel

spel
`;
    const expected = `spell
spell

spell

spell
`;
    const output = await process(input, 'spacing-spell');
    expect(output).toBe(expected);
  });

  /*
   * Test contractions and quotes
   */

  it("replace smart contractions and quotes", async () => {
    const input = `\u201cThis is just a quote\u201d... don\u2019t worry!
`;
    const expected = `"This is just a quote"... don't worry!
`;
    const output = await process(input, 'quotes-contractions');
    expect(output).toBe(expected);
  });

  /*
   * Test contractions and spelling
   */

  it("handle conflict between contraction and spelling", async () => {
    const input = `If it were done, when tis done, then twere well it were done quickly
`;
    const expected = `If it were done, when 'tis done, then 'twere well it were done quickly
`;
    const output = await process(input, 'spell-contractions');
    expect(output).toBe(expected);
  });

  /*
   * Test indefinite articles and diacritics
   */

  it("replace indefinite articles and diacritics", async () => {
    const input = `Can a ubermensch prepare a crepe at an cafe?
`;
    const expected = `Can an übermensch prepare a crêpe at a café?
`;
    const output = await process(input, 'indefinite-article-diacritics');
    expect(output).toBe(expected);
  });

  /*
   * Test custom fixers
   */

  it("censor profanities with custom fixer", async () => {
    const input = `Ah geez, you are not a loser.
`;
    const expected = `Ah g---, you are not a l----.
`;
    const output = await process(input, 'profanities', {
      fixers: {
        'retext-profanities': (message) => {
          // Censor all but first letter of certain cuss words
          if (message.profanitySeverity >= 2 ) {
            return message.actual.replace(/\B./g,'-')
          } 
        }
      }
    });
    expect(output).toBe(expected);
  });

  // End of tests
});
