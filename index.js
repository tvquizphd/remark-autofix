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

const node_or_child_in_list = (list, node) => {
  if (list.includes(node)) {
    return true;
  }
  if (node.children) {
    for (const child of node.children) {
      if (list.includes(child)) {
        return true;
      }
    }
  }
  return false;
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
      let [start, end, only_expected] = [
        message.location.start.offset,
        message.location.end.offset,
        fixer(message)
      ];
      if (message.source === "retext-spell") {
        if (only_expected) {
          copySpellMap.set(message.actual, only_expected);
        } else {
          only_expected = copySpellMap.get(message.actual);
        }
      }
      // Filter messages in relevant paragraph
      if (start < min_start || end > max_end) {
        return;
      }
      if ([start, end, only_expected].every((v) => v != null)) {
        fixes.push({
          actual: message.actual,
          expected: [only_expected],
          start,
          end
        });
      }
    }
  });
  // Sort fixes from first to last
  fixes = fixes.sort((fix_a, fix_b) => {
    return Math.sign(fix_a.start - fix_b.start)
  })
  // Merge fixes with overlapping locations
  fixes = fixes.reduce((merged_fixes, fix) => {
    if (merged_fixes.length) {
      const top_fix = merged_fixes[merged_fixes.length - 1];
      const top_overlap = is_overlap(
        [top_fix.start, top_fix.end],
        [fix.start, fix.end]
      );
      if (top_overlap) {
        top_fix.end = Math.max(top_fix.end, fix.end);
        // Replace existing expected values fixed by current fix
        top_fix.expected = top_fix.expected.map((expected) => {
          return (fix.actual === expected)? fix.expected[0] : expected
        })
        // Only track fixes with new expected values
        if (!top_fix.expected.includes(fix.expected[0])) {
          top_fix.expected.push(fix.expected[0]);
          if (top_fix.start == fix.start) {
            top_fix.n_same_start += 1;
          }
        }
        return merged_fixes;
      }
    }
    delete fix.actual;
    merged_fixes.push({
      ...fix,
      n_same_start: 1,
    });
    return merged_fixes;
  }, []);
  // Add mdast list with deletions and select one expected value
  fixes = fixes.map((fix) => {
    const { start, end } = fix;
    const mdast_list = match_tree_literals(
      mdast,
      [start, end],
      "paragraph"
    ).map((v) => {
      const nlcst = treeMap.get(v.node);
      const nlcst_list = match_tree_literals(nlcst, [start, end]).map(
        (_v) => _v.node
      );
      const nlcst_children = nlcst_to_children(nlcst, (node) => {
        return node_or_child_in_list(nlcst_list, node);
      });
      return {
        ...v,
        delMap: nlcst_children.reduce((delMap, { node, parent }) => {
          const nlcst_remove = delMap.get(parent) || [];
          nlcst_remove.push({
            node: node,
            action: -1
          });
          delMap.set(parent, nlcst_remove);
          return delMap;
        }, new Map())
      };
    });
    return {
      ...fix,
      mdast_list,
      max_priority: Math.max(...mdast_list.map((v) => v.priority))
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

const longest_common_substring = (s1, s2) => {
  const n_row = s1.length + 1;
  const n_col = s2.length + 1;
  const table = new Int16Array(n_row * n_col).fill(0);
  const t_i = (r, c) => r * n_col + c;

  let longest = 0;
  for (let r = 1; r < n_row; r++) {
    for (let c = 1; c < n_col; c++) {
      if (s1[r - 1] === s2[c - 1]) {
        table[t_i(r, c)] = table[t_i(r - 1, c - 1)] + 1;
        longest = Math.max(table[t_i(r, c)], longest);
      }
    }
  }
  return longest;
}

const select_expected = (expected, n_same_start, text_remove) => {
  // Use first expected value if one definitve first expected value
  if (n_same_start <= 1) {
    return expected[0] || ''
  }
  /* Use expected value with longest common substring in source text
     in case of multiple values with the same start */
  const same_start_expected = expected.slice(0, n_same_start);
  return same_start_expected.sort((a, b) => {
    return (
      longest_common_substring(text_remove, b) -
      longest_common_substring(text_remove, a)
    );
  })[0] || '';
  return only_expected
}

const list_additions = ({expected, n_same_start}, text_remove) => {
  const only_expected = select_expected(expected, n_same_start, text_remove);
  const new_children = text_to_children(only_expected);
  return new_children.map(({ node }) => {
    return {
      action: 1,
      node: node
    };
  });
}

const check_fixes = (fixes, treeMap) => {
  const childrenMap = new Map();
  fixes.forEach((fix) => {
    const { max_priority, mdast_list } = fix;
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
        // Calculate the text to remove from parent of v
        const text_remove = nlcst_to_text.stringify({
          type: "SentenceNode",
          children: nlcst_remove.map((remove) => remove.node)
        });
        // Only add if node has priority and on first parent of v
        const should_add = (priority_node === v.node && parentCount === 0);
        let nlcst_add = should_add? list_additions(fix, text_remove) : [];
        const text_add = nlcst_to_text.stringify({
          type: "SentenceNode",
          children: nlcst_add.map((add) => add.node)
        });
        // Check if adding and removing cancel out
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
