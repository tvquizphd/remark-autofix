const remark_retext = require("remark-retext");
const retext_english = require("retext-english");
const retext_stringify = require("retext-stringify");
const unist_remove_position = require("unist-util-remove-position");
const unist_visit_parents = require("unist-util-visit-parents");
const unist_position = require("unist-util-position");
const unist_filter = require("unist-util-filter");
const unist_remove = require("unist-util-remove");
const unist_visit = require("unist-util-visit");
const unist_is = require("unist-util-is");
const unified = require("unified");

const is_overlap = ([start, end], [_start, _end]) => {
  if ([_start, start, end, _end].some((v) => v == null)) {
    return false;
  }
  return _start < end && start < _end;
};

const is_overlap_nodes = (node, _node) => {
  const node_position = unist_position(node);
  const start = node_position.start.offset;
  const end = node_position.end.offset;
  const _node_position = unist_position(_node);
  const _start = _node_position.start.offset;
  const _end = _node_position.end.offset;
  return is_overlap([start, end], [_start, _end]);
};

const match_tree_literals = (tree, offsets = [], ancestor = "") => {
  const literals = [];
  if (!tree) {
    return literals;
  }
  unist_visit_parents(tree, (node, ancestors) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return;
    }
    let should_push = true;
    if (offsets.length) {
      const node_position = unist_position(node);
      should_push = is_overlap(offsets, [
        node_position.start.offset,
        node_position.end.offset
      ]);
    }
    if (should_push) {
      let priority = 0;
      if (ancestor) {
        priority = ancestors.reverse().reduce((v, a) => {
          if (unist_is(a, ancestor)) {
            return v;
          }
          return v + 1;
        }, 0);
      }
      literals.push({
        priority,
        node
      });
    }
  });
  return literals;
};

const extract_fixes = (mdast, treeMap, options) => {
  let fixes = [];
  const last_mdast_i = treeMap.size - 1;
  const mdast_nodes = Array.from(treeMap.keys());
  // Filter messages in releant paragraph
  const min_start = mdast_nodes[0].position.start.offset;
  const max_end = mdast_nodes[last_mdast_i].position.end.offset;
  const accepted = [
    "retext-spell",
    "retext-quotes",
    "retext-diacritics",
    "retext-contractions",
    "retext-repeated-words",
    "retext-sentence-spacing",
    "retext-indefinite-article",
    "retext-redundant-acronyms"
  ];
  const { file, fixers } = options;
  Object.keys(fixers).forEach((key) => {
    accepted.push(key);
  })
  const default_fixer = ({expected}) => {
    return (expected && expected.length)? expected[0] : null
  }
  const copySpellMap = new Map();
  file.messages.forEach((message) => {
    if (accepted.includes(message.source)) {
      const fixer = fixers[message.source] || default_fixer;
      let [start, end, expected] = [
        message.location.start.offset,
        message.location.end.offset,
        fixer(message)
      ];
      if (message.source === "retext-spell") {
        if (expected) {
          copySpellMap.set(message.actual, expected);
        } else {
          expected = copySpellMap.get(message.actual);
        }
      }
      // Filter messages in relevant paragraph
      if (start < min_start || end > max_end) {
        return;
      }
      if ([start, end, expected].every((v) => v != null)) {
        fixes.push({
          expected: [expected],
          start,
          end
        });
      }
    }
  });
  fixes = fixes.reduce((merged_fixes, fix) => {
    const [to_keep, to_merge] = merged_fixes.reduce(
      ([_keep, _merge], _fix) => {
        const _overlap = is_overlap(
          [fix.start, fix.end],
          [_fix.start, _fix.end]
        );
        return [
          _overlap ? _keep : _keep.concat(_fix),
          _overlap ? _merge.concat(_fix) : _merge
        ];
      },
      [[], []]
    );
    /*if (to_merge.length > 0) {
      if (to_merge[0].expected.length > 1) {
        console.log('TODO')
      }
    }*/
    to_keep.push({
      expected: fix.expected.concat(...to_merge.map((_fix) => _fix.expected)),
      start: Math.min(fix.start, ...to_merge.map((_fix) => _fix.start)),
      end: Math.max(fix.end, ...to_merge.map((_fix) => _fix.end))
    });
    return to_keep;
  }, []);
  fixes = fixes.map(({ expected, start, end }) => {
    const mdast_list = match_tree_literals(
      mdast,
      [start, end],
      "paragraph"
    ).map((v) => {
      const nlcst = treeMap.get(v.node);
      const nlcst_list = match_tree_literals(nlcst, [start, end]).map(
        (_v) => _v.node
      );
      const child_in_list = (children) => {
        if (children) {
          for (const child of children) {
            if (nlcst_list.includes(child)) {
              return true;
            }
          }
        }
        return false;
      };
      const nlcst_children = nlcst_to_children(nlcst, (node) => {
        const in_list = nlcst_list.includes(node);
        return in_list || child_in_list(node.children);
      });
      return {
        ...v,
        delMap: nlcst_children.reduce((delMap, { node, parent }) => {
          const nlcst_remove = delMap.get(parent) || [];
          delMap.set(
            parent,
            nlcst_remove.concat({
              node: node,
              action: -1
            })
          );
          return delMap;
        }, new Map())
      };
    });
    return {
      max_priority: Math.max(...mdast_list.map((v) => v.priority)),
      mdast_list,
      expected,
      start,
      end
    };
  });
  // Later code relies on sorted fixes
  fixes = fixes.sort((fix_a, fix_b) => fix_a.start - fix_b.start);
  return fixes;
};

const nlcst_to_children = (tree, callback = null) => {
  const children = [];
  if (!tree) {
    return children;
  }
  unist_visit_parents(tree, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    const is_space = () => unist_is(node, "WhiteSpaceNode");
    const parent_is_sentence = () => unist_is(parent, "SentenceNode");
    if (parent_is_sentence() || is_space()) {
      if (!callback || callback(node)) {
        children.push({
          parent,
          node
        });
      }
    }
  });
  return children;
};

const text_to_children = (str) => {
  const tree = text_to_nlcst.runSync(text_to_nlcst.parse(str));
  return nlcst_to_children(tree, (node) => {
    unist_remove_position(node);
    return true;
  });
};

const find_mode = (arr) => {
  if (arr.length == 1) {
    return arr[0]
  }
  const {mode, maxFreq, vMapping} = arr.reduce(
    (state, item) => {
      var val = (state.vMapping[item] = (state.vMapping[item] || 0) + 1);
      if (val > state.maxFreq) {
        state.maxFreq = val;
        state.mode = item;
      }
      return state;
    },
    { mode: null, maxFreq: -Infinity, vMapping: {} }
  );
  const minFreq = Math.min(...Object.values(vMapping))
  if (minFreq == maxFreq) {
    return null
  }
  return mode
};

const check_fixes = (fixes, treeMap) => {
  const childrenMap = new Map();
  fixes.forEach(({ expected, max_priority, mdast_list }) => {
    let expected_string = find_mode(expected)
    if (expected_string == null) {
      // Use first expected value if no mode
      expected_string = expected[0] || ''
    }
    const new_children = text_to_children(expected_string);
    const priority_node = mdast_list.find((v) => {
      return v.priority >= max_priority;
    }).node;
    mdast_list.forEach((v) => {
      let { delMap } = v;
      const { changeMap } = childrenMap.get(v.node) || {
        changeMap: new Map()
      };
      let parentCount = 0;
      delMap.forEach((nlcst_remove, parent) => {
        let nlcst_add = [];
        // Only add if node has priority and on first parent
        if (priority_node === v.node && parentCount === 0) {
          nlcst_add = new_children.map(({ node }) => {
            return {
              action: 1,
              node: node
            };
          });
        }
        // Check if adding and removing cancel out
        const text_add = nlcst_to_text.stringify({
          type: "SentenceNode",
          children: nlcst_add.map((add) => add.node)
        });
        const text_remove = nlcst_to_text.stringify({
          type: "SentenceNode",
          children: nlcst_remove.map((remove) => remove.node)
        });
        if (text_add === text_remove) {
          nlcst_add = [];
          nlcst_remove = [];
        }
        const changes = changeMap.get(parent) || [];
        changeMap.set(parent, changes.concat(nlcst_remove).concat(nlcst_add));
        parentCount += 1;
      });
      childrenMap.set(v.node, {
        changeMap: changeMap
      });
    });
  });
  const fixMap = new Map();
  treeMap.forEach((nlcst, node) => {
    if (childrenMap.has(node)) {
      const { changeMap } = childrenMap.get(node);
      // This change map should modify the nlcst
      changeMap.forEach((changes, parent) => {
        parent.children = parent.children.reduce((children, child) => {
          if (changes.length) {
            // Assume changes are sorted
            if (changes[0].action === -1) {
              if (child === changes[0].node) {
                changes.shift();
              } else {
                children.push(child);
              }
            }
            while (changes.length && changes[0].action === 1) {
              const added_node = changes.shift().node;
              children.push(added_node);
            }
          } else {
            children.push(child);
          }
          return children;
        }, []);
      });
      const new_string = nlcst_to_text.stringify(nlcst);
      fixMap.set(node, new_string);
    }
  });
  return fixMap;
};

const text_to_nlcst = unified().use(retext_english);
const nlcst_to_text = unified().use(retext_stringify);

const p_to_nlcst = unified().use(remark_retext, retext_english.Parser);

const paragraph_handler = (p, options) => {
  let fixMap = new Map();
  // Extract all fixes from computed nlcst
  p_to_nlcst()
    .use(() => {
      return (tree, _) => {
        const mdast_list = match_tree_literals(p, [], "paragraph");
        const treeMap = mdast_list.reduce((tree_map, mdast) => {
          const subtree = unist_filter(tree, (node) => {
            return is_overlap_nodes(mdast.node, node);
          });
          if (!!subtree) {
            tree_map.set(mdast.node, subtree);
          }
          return tree_map;
        }, new Map());
        const fixes = extract_fixes(p, treeMap, options);
        fixMap = check_fixes(fixes, treeMap);
        return tree;
      };
    })
    .runSync(p, options.file);
  // Apply all the fixes to all of the mdast nodes
  unist_visit(p, (node) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return node;
    }
    if (fixMap.has(node)) {
      node.value = fixMap.get(node);
    }
    return node;
  })
  // Removes all empty literal nodes
  // Such as when *dup* *dup* -> *dup* **
  unist_remove(p, (node) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return false;
    }
    return node.value === "";
  });
};

function remark_autofix (options) {
  return (tree, file) => {
    unist_visit(tree, 'paragraph', (p) => {
      paragraph_handler(p, {
        fixers: {},
        ...options, file
      })
    });
    return tree;
  };
};

module.exports = remark_autofix
